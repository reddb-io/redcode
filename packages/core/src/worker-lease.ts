export * as WorkerLease from "./worker-lease.js"

import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { WorkerLease } from "@opencode/schema/worker-lease"
import { Session } from "@opencode/schema/session"
import { AbsolutePath } from "@opencode/schema/schema"
import { FSUtil } from "@opencode/util/fs-util"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Database } from "./database/database.js"
import { ExecutionOwner } from "./execution-owner.js"
import { SessionInboxTable, SessionTable } from "./session/sql.js"
import { WorkerAssignmentTable, WorkerLeaseTable } from "./worker-lease.sql.js"

export { Acquire, Claim, Fence, Info, Result } from "@opencode/schema/worker-lease"

export const TTL = 60_000
export class Conflict extends Schema.TaggedError<Conflict>()("WorkerLease.Conflict", { message: Schema.String }) {}

type Row = typeof WorkerLeaseTable.$inferSelect
const info = (row: Row): WorkerLease.Info => ({
  directory: AbsolutePath.make(row.directory),
  owner: row.owner,
  holder: row.holder,
  sessionID: row.session_id,
  messageID: row.message_id,
  generation: row.generation,
  expiresAt: row.expires_at,
  remainingMs: Math.max(0, row.expires_at - Date.now()),
})
const liveOperations = (row: Row) => row.operations.filter((operation) => ExecutionOwner.alive(operation.runtime))
const matches = (row: Row, fence: WorkerLease.Fence) =>
  !row.released && row.owner === fence.owner && row.holder === fence.holder && row.generation === fence.generation
const conflict = () => new Conflict({ message: "Worker lease expired or fenced; recover the original assignment" })

// Both the worker's lease acquisition and this execution gate commit in SQLite.
// Expiration revokes coordinator commands, never an already admitted execution.
export function executionGate(sessionID: Session.ID, directory: string) {
  return sql`not exists (
    with recursive lineage(id, parent_id) as (
      select id, parent_id from session_v2 where id = ${sessionID}
      union all select s.id, s.parent_id from session_v2 s join lineage l on s.id = l.parent_id
    ) select 1 from worker_assignment a join lineage l on l.id = a.session_id
      left join worker_lease w on w.directory = a.directory
      where w.directory is null or w.released = 1 or w.generation != a.generation or w.session_id != a.session_id
        or (a.session_id = ${sessionID} and a.directory != ${directory})
  ) and not exists (
    with recursive lineage(id, parent_id) as (
      select id, parent_id from session_v2 where id = ${sessionID}
      union all select s.id, s.parent_id from session_v2 s join lineage l on s.id = l.parent_id
    ) select 1 from worker_lease w where w.directory = ${directory} and w.released = 0
      and w.session_id not in (select id from lineage)
  )`
}

export class Service extends Context.Service<
  Service,
  {
    readonly acquire: (input: WorkerLease.Acquire) => Effect.Effect<WorkerLease.Result, Conflict>
    readonly renew: (input: WorkerLease.Info) => Effect.Effect<WorkerLease.Info, Conflict>
    readonly release: (input: WorkerLease.Info) => Effect.Effect<void, Conflict>
    readonly enter: (sessionID: Session.ID, fence?: WorkerLease.Fence) => Effect.Effect<string | undefined, Conflict>
    readonly leave: (operation: string | undefined) => Effect.Effect<void>
    readonly directory: (directory: string) => Effect.Effect<string, Conflict>
  }
>()("@opencode/WorkerLease") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const fs = yield* FSUtil.Service
    const runtime = yield* ExecutionOwner.make
    const directory = (value: string) =>
      fs.realPath(value).pipe(
        Effect.map((value) =>
          process.platform === "win32" ? path.normalize(value).toLowerCase() : path.normalize(value),
        ),
        Effect.mapError(() => new Conflict({ message: "The worker checkout must exist before it can be reserved" })),
      )
    const transaction = <A>(body: () => Effect.Effect<A, Conflict>) =>
      db.transaction(body).pipe(Effect.catchTag("SqlError", Effect.die))
    const busy = Effect.fnUntraced(function* (key: string, sessionID: Session.ID) {
      const rows = yield* db
        .select({ suspended: SessionTable.time_suspended, owner: SessionTable.execution_owner })
        .from(SessionTable)
        .where(
          sql`
      ${SessionTable.execution_directory} = ${key}
      or (${SessionTable.execution_directory} is null and (${SessionTable.time_suspended} is not null or ${SessionTable.execution_owner} is not null))
      or ${SessionTable.id} in (
        with recursive children(id) as (select ${sessionID} union all
          select s.id from session_v2 s join children c on s.parent_id = c.id)
        select id from children
      )`,
        )
        .pipe(Effect.orDie)
      if (rows.some((row) => row.suspended !== null || (row.owner && ExecutionOwner.alive(row.owner)))) return true
      const pending = yield* db
        .select({ id: SessionInboxTable.id })
        .from(SessionInboxTable)
        .where(
          sql`
      ${SessionInboxTable.session_id} in (
        with recursive children(id) as (select ${sessionID} union all
          select s.id from session_v2 s join children c on s.parent_id = c.id)
        select id from children
      )`,
        )
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      return pending !== undefined
    })
    const requireLease = Effect.fnUntraced(function* (input: WorkerLease.Info) {
      const row = yield* db
        .select()
        .from(WorkerLeaseTable)
        .where(eq(WorkerLeaseTable.directory, input.directory))
        .get()
        .pipe(Effect.orDie)
      if (
        !row ||
        !matches(row, input) ||
        row.session_id !== input.sessionID ||
        row.message_id !== input.messageID ||
        row.expires_at <= Date.now()
      )
        return yield* conflict()
      return row
    })
    return Service.of({
      directory,
      acquire: Effect.fn("WorkerLease.acquire")(function* (input) {
        const key = yield* directory(input.directory)
        return yield* transaction(() =>
          Effect.gen(function* () {
            const row = yield* db
              .select()
              .from(WorkerLeaseTable)
              .where(eq(WorkerLeaseTable.directory, key))
              .get()
              .pipe(Effect.orDie)
            if (
              row?.released &&
              row.owner === input.owner &&
              row.session_id === input.sessionID &&
              row.message_id === input.messageID
            )
              return { state: "released", lease: info(row) } as const
            const same =
              row &&
              !row.released &&
              row.owner === input.owner &&
              row.session_id === input.sessionID &&
              row.message_id === input.messageID
            // A retry of the original acquire returns its original deadline. It never renews implicitly.
            if (same && !input.recover)
              return { state: row.holder === input.holder ? "acquired" : "held", lease: info(row) } as const
            if (row && !row.released && !same) return { state: "busy" } as const
            if (same && input.recover) {
              if (!matches(row, input.recover)) return yield* conflict()
              if (row.expires_at > Date.now())
                return row.holder === input.holder
                  ? ({ state: "acquired", lease: info(row) } as const)
                  : ({ state: "busy" } as const)
              if (liveOperations(row).length) return { state: "busy" } as const
            }
            if (!same && (yield* busy(key, input.sessionID))) return { state: "busy" } as const
            const previous = yield* db
              .select()
              .from(WorkerAssignmentTable)
              .where(eq(WorkerAssignmentTable.session_id, input.sessionID))
              .get()
              .pipe(Effect.orDie)
            if (previous && !same) return yield* conflict()
            const next: Row = {
              directory: key,
              owner: input.owner,
              holder: input.holder,
              session_id: input.sessionID,
              message_id: input.messageID,
              generation: (row?.generation ?? 0) + 1,
              expires_at: Date.now() + TTL,
              released: false,
              operations: [],
            }
            yield* db
              .insert(WorkerLeaseTable)
              .values(next)
              .onConflictDoUpdate({ target: WorkerLeaseTable.directory, set: next })
              .run()
              .pipe(Effect.orDie)
            yield* db
              .insert(WorkerAssignmentTable)
              .values({ session_id: input.sessionID, directory: key, generation: next.generation })
              .onConflictDoUpdate({ target: WorkerAssignmentTable.session_id, set: { generation: next.generation } })
              .run()
              .pipe(Effect.orDie)
            return { state: "acquired", lease: info(next) } as const
          }),
        )
      }),
      renew: (input) =>
        transaction(() =>
          Effect.gen(function* () {
            const row = yield* requireLease(input)
            const next = { ...row, expires_at: Date.now() + TTL, operations: liveOperations(row) }
            yield* db
              .update(WorkerLeaseTable)
              .set(next)
              .where(eq(WorkerLeaseTable.directory, row.directory))
              .run()
              .pipe(Effect.orDie)
            return info(next)
          }),
        ),
      release: (input) =>
        transaction(() =>
          Effect.gen(function* () {
            const previous = yield* db
              .select()
              .from(WorkerLeaseTable)
              .where(eq(WorkerLeaseTable.directory, input.directory))
              .get()
              .pipe(Effect.orDie)
            if (
              previous?.released &&
              previous.owner === input.owner &&
              previous.generation === input.generation &&
              previous.session_id === input.sessionID &&
              previous.message_id === input.messageID
            )
              return
            const row = yield* requireLease(input)
            if (liveOperations(row).length || (yield* busy(row.directory, row.session_id)))
              return yield* new Conflict({
                message: "The checkout still has admitted or executing work; its reservation is retained",
              })
            yield* db
              .update(WorkerLeaseTable)
              .set({ released: true, operations: [] })
              .where(eq(WorkerLeaseTable.directory, row.directory))
              .run()
              .pipe(Effect.orDie)
          }),
        ),
      enter: (sessionID, fence) =>
        transaction(() =>
          Effect.gen(function* () {
            const assignment = yield* db
              .select()
              .from(WorkerAssignmentTable)
              .where(
                sql`${WorkerAssignmentTable.session_id} in (
        with recursive lineage(id, parent_id) as (
          select id, parent_id from session_v2 where id = ${sessionID}
          union all select s.id, s.parent_id from session_v2 s join lineage l on s.id = l.parent_id
        ) select id from lineage union select ${sessionID}
      )`,
              )
              .get()
              .pipe(Effect.orDie)
            if (!assignment) {
              if (fence) return yield* conflict()
              return
            }
            const row = yield* db
              .select()
              .from(WorkerLeaseTable)
              .where(eq(WorkerLeaseTable.directory, assignment.directory))
              .get()
              .pipe(Effect.orDie)
            if (
              !row ||
              !fence ||
              !matches(row, fence) ||
              row.generation !== assignment.generation ||
              row.session_id !== assignment.session_id ||
              row.expires_at <= Date.now()
            )
              return yield* conflict()
            const operation = randomUUID()
            yield* db
              .update(WorkerLeaseTable)
              .set({ operations: [...liveOperations(row), { id: operation, runtime }] })
              .where(eq(WorkerLeaseTable.directory, row.directory))
              .run()
              .pipe(Effect.orDie)
            return operation
          }),
        ),
      leave: (operation) =>
        operation === undefined
          ? Effect.void
          : transaction(() =>
              Effect.gen(function* () {
                const rows = yield* db
                  .select()
                  .from(WorkerLeaseTable)
                  .where(sql`json_array_length(${WorkerLeaseTable.operations}) > 0`)
                  .pipe(Effect.orDie)
                for (const row of rows) {
                  if (!row.operations.some((entry) => entry.id === operation)) continue
                  yield* db
                    .update(WorkerLeaseTable)
                    .set({ operations: row.operations.filter((entry) => entry.id !== operation) })
                    .where(
                      and(
                        eq(WorkerLeaseTable.directory, row.directory),
                        eq(WorkerLeaseTable.generation, row.generation),
                      ),
                    )
                    .run()
                    .pipe(Effect.orDie)
                }
              }),
            ).pipe(Effect.orDie),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, FSUtil.node] })
