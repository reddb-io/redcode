export * as SessionStore from "./store.js"

import { and, asc, desc, eq, gt, isNotNull, isNull, like, lt, notInArray, or, sql, type SQL } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { ExecutionOwner } from "../execution-owner.js"
import { executionGate } from "../worker-lease.js"
import { FSUtil } from "@opencode/util/fs-util"
import path from "node:path"
import { Project } from "@opencode/schema/project"
import { Workspace } from "@opencode/schema/workspace"
import { AbsolutePath, PositiveInt, RelativePath } from "@opencode/schema/schema"
import { Database } from "../database/database.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { SessionArchive } from "./archive.js"
import { SessionHistory } from "./history.js"
import { MessageDecodeError } from "./error.js"
import { SessionMessage } from "./message.js"
import { Session } from "@opencode/schema/session"
import { SessionObservation } from "@opencode/schema/session-observation"
import { SessionInboxTable, SessionMessageTable, SessionTable } from "./sql.js"
import { fromRow } from "./info.js"

const ListInputBase = {
  workspaceID: Workspace.ID.pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
  archived: Schema.Literals(["exclude", "include", "only"]).pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
  order: Schema.Literals(["asc", "desc"]).pipe(Schema.optional),
  parentID: Schema.NullOr(Session.ID).pipe(Schema.optional),
  anchor: Session.ListAnchor.pipe(Schema.optional),
}

const ListDirectoryInput = Schema.Struct({
  ...ListInputBase,
  directory: AbsolutePath,
})

const ListProjectInput = Schema.Struct({
  ...ListInputBase,
  project: Project.ID,
  subpath: RelativePath.pipe(Schema.optional),
})

const ListAllInput = Schema.Struct(ListInputBase)

export const ListInput = Schema.Union([ListDirectoryInput, ListProjectInput, ListAllInput])
export type ListInput = typeof ListInput.Type

export type MessagesInput = {
  sessionID: Session.ID
  limit?: number
  order?: "asc" | "desc"
  type?: SessionMessage.Type
  cursor?: {
    id: SessionMessage.ID
    direction: "previous" | "next"
  }
}

export interface Interface {
  readonly observation: (
    sessionID: Session.ID,
    messageID: SessionMessage.ID,
  ) => Effect.Effect<Omit<SessionObservation.Info, "waiting"> | undefined>
  readonly acquireExecution: (sessionID: Session.ID) => Effect.Effect<boolean>
  readonly releaseExecution: (sessionID: Session.ID) => Effect.Effect<void>
  readonly executionOwnedElsewhere: (sessionID: Session.ID) => Effect.Effect<boolean>
  readonly get: (sessionID: Session.ID) => Effect.Effect<Session.Info | undefined>
  readonly cacheRoot: (sessionID: Session.ID) => Effect.Effect<Session.ID | undefined>
  readonly list: (input?: ListInput) => Effect.Effect<Session.Info[]>
  readonly messages: (input: MessagesInput) => Effect.Effect<SessionMessage.Info[], MessageDecodeError>
  readonly context: (sessionID: Session.ID) => Effect.Effect<SessionMessage.Info[], MessageDecodeError>
  readonly message: (
    messageID: SessionMessage.ID,
  ) => Effect.Effect<{ readonly sessionID: Session.ID; readonly message: SessionMessage.Info } | undefined>
  /**
   * Top-level Sessions holding an execution claim. Recoverable background
   * children are resumed separately through their durable Job records.
   */
  readonly listSuspended: () => Effect.Effect<ReadonlyArray<Session.ID>>
  /**
   * Records the execution claim: the durable write-ahead intent that a turn is
   * (or was) in flight. Set when execution starts; a claim that survives to the
   * next boot marks a turn that never completed — its process crashed or shut
   * down mid-turn.
   */
  readonly claim: (sessionID: Session.ID) => Effect.Effect<void>
  /** Releases the claim and resets resume accounting. Terminal events call this on commit. */
  readonly release: (sessionID: Session.ID) => Effect.Effect<void>
  /**
   * Clears orphaned child claims except children owned by recoverable
   * background subagent jobs.
   */
  readonly releaseChildClaims: (recoverable: ReadonlyArray<Session.ID>) => Effect.Effect<void>
  /**
   * Durably counts one more resume of an orphaned claim, returning the new
   * total — or undefined when the Session no longer exists.
   */
  readonly countResume: (sessionID: Session.ID) => Effect.Effect<number | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStore") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const owner = yield* ExecutionOwner.make
    const fs = yield* FSUtil.Service
    const ownedElsewhere = (value: ExecutionOwner.Info | null) =>
      value !== null && value.token !== owner.token && ExecutionOwner.alive(value)

    return Service.of({
      observation: Effect.fn("SessionStore.observation")(function* (sessionID, messageID) {
        // One SQLite snapshot: delivery consumes the inbox and inserts the message
        // atomically, so separate HTTP reads cannot lose the admission between them.
        const row = yield* db
          .select({
            directory: SessionTable.directory,
            owner: SessionTable.execution_owner,
            suspended: SessionTable.time_suspended,
            outcome: SessionTable.idle_outcome,
            pending:
              sql<boolean>`exists(select 1 from ${SessionInboxTable} where ${SessionInboxTable.session_id} = ${SessionTable.id})`.mapWith(
                Boolean,
              ),
            admitted:
              sql<boolean>`exists(select 1 from ${SessionInboxTable} where ${SessionInboxTable.session_id} = ${SessionTable.id} and ${SessionInboxTable.id} = ${messageID} and ${SessionInboxTable.type} = 'user')`.mapWith(
                Boolean,
              ),
            delivered:
              sql<boolean>`exists(select 1 from ${SessionMessageTable} where ${SessionMessageTable.session_id} = ${SessionTable.id} and ${SessionMessageTable.id} = ${messageID} and ${SessionMessageTable.type} = 'user')`.mapWith(
                Boolean,
              ),
          })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        if (!row) return undefined
        return {
          sessionID,
          messageID,
          directory: AbsolutePath.make(row.directory),
          admission: row.delivered ? "delivered" : row.admitted ? "pending" : "missing",
          execution:
            row.owner && ExecutionOwner.alive(row.owner) ? "running" : row.suspended !== null ? "suspended" : "idle",
          pending: row.pending,
          outcome: row.outcome ?? undefined,
        }
      }),
      acquireExecution: Effect.fn("SessionStore.acquireExecution")(function* (sessionID) {
        const row = yield* db
          .select({ owner: SessionTable.execution_owner, directory: SessionTable.directory })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        if (!row || ownedElsewhere(row.owner)) return false
        const resolved = yield* fs.resolve(row.directory)
        const directory =
          process.platform === "win32" ? path.normalize(resolved).toLowerCase() : path.normalize(resolved)
        const acquired = yield* db
          .update(SessionTable)
          .set({
            execution_owner: owner,
            execution_directory: directory,
            time_updated: sql`${SessionTable.time_updated}`,
          })
          .where(
            and(
              eq(SessionTable.id, sessionID),
              SessionArchive.writableGate(sessionID),
              executionGate(sessionID, directory),
              row.owner === null ? isNull(SessionTable.execution_owner) : eq(SessionTable.execution_owner, row.owner),
            ),
          )
          .returning({ id: SessionTable.id })
          .get()
          .pipe(Effect.orDie)
        return acquired !== undefined
      }),
      releaseExecution: Effect.fn("SessionStore.releaseExecution")((sessionID) =>
        db
          .update(SessionTable)
          .set({ execution_owner: null, time_updated: sql`${SessionTable.time_updated}` })
          .where(and(eq(SessionTable.id, sessionID), eq(SessionTable.execution_owner, owner)))
          .run()
          .pipe(Effect.orDie, Effect.asVoid),
      ),
      executionOwnedElsewhere: Effect.fn("SessionStore.executionOwnedElsewhere")(function* (sessionID) {
        const row = yield* db
          .select({ owner: SessionTable.execution_owner })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        return row ? ownedElsewhere(row.owner) : false
      }),
      get: Effect.fnUntraced(function* (sessionID) {
        const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
        return row ? fromRow(row) : undefined
      }),
      cacheRoot: Effect.fnUntraced(function* (sessionID) {
        const row = yield* db
          .select({
            id: SessionTable.id,
            root: SessionTable.cache_root_id,
            parent: SessionTable.parent_id,
            fork: SessionTable.fork_session_id,
          })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        return row?.root ?? row?.parent ?? row?.fork ?? row?.id
      }),
      list: Effect.fn("SessionStore.list")(function* (input = {}) {
        const direction = input.anchor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const sortColumn = SessionTable.time_updated
        const conditions: SQL[] = []
        if (input.archived === "exclude") conditions.push(isNull(SessionTable.time_archived))
        if (input.archived === "only") conditions.push(isNotNull(SessionTable.time_archived))
        if ("directory" in input) conditions.push(eq(SessionTable.directory, input.directory))
        if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
        if ("project" in input) conditions.push(eq(SessionTable.project_id, input.project))
        if ("project" in input && input.subpath !== undefined) conditions.push(eq(SessionTable.path, input.subpath))
        if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
        if (input.parentID !== undefined)
          conditions.push(
            input.parentID === null ? isNull(SessionTable.parent_id) : eq(SessionTable.parent_id, input.parentID),
          )
        if (input.anchor) {
          conditions.push(
            order === "asc"
              ? or(
                  gt(sortColumn, input.anchor.time),
                  and(eq(sortColumn, input.anchor.time), gt(SessionTable.id, input.anchor.id)),
                )!
              : or(
                  lt(sortColumn, input.anchor.time),
                  and(eq(sortColumn, input.anchor.time), lt(SessionTable.id, input.anchor.id)),
                )!,
          )
        }
        const query = db
          .select()
          .from(SessionTable)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(
            order === "asc" ? asc(sortColumn) : desc(sortColumn),
            order === "asc" ? asc(SessionTable.id) : desc(SessionTable.id),
          )
        const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
          Effect.orDie,
        )
        return (direction === "previous" ? rows.toReversed() : rows).map((row) => fromRow(row))
      }),
      messages: Effect.fn("SessionStore.messages")(function* (input) {
        const direction = input.cursor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const anchor = input.cursor
          ? yield* db
              .select({ seq: SessionMessageTable.seq })
              .from(SessionMessageTable)
              .where(
                and(eq(SessionMessageTable.session_id, input.sessionID), eq(SessionMessageTable.id, input.cursor.id)),
              )
              .get()
              .pipe(Effect.orDie)
          : undefined
        if (input.cursor && !anchor) return []
        const boundary = anchor
          ? order === "asc"
            ? gt(SessionMessageTable.seq, anchor.seq)
            : lt(SessionMessageTable.seq, anchor.seq)
          : undefined
        const query = db
          .select()
          .from(SessionMessageTable)
          .where(
            and(
              eq(SessionMessageTable.session_id, input.sessionID),
              boundary,
              input.type === undefined ? undefined : eq(SessionMessageTable.type, input.type),
            ),
          )
          .orderBy(order === "asc" ? asc(SessionMessageTable.seq) : desc(SessionMessageTable.seq))
        const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
          Effect.orDie,
        )
        return yield* Effect.forEach(
          direction === "previous" ? rows.toReversed() : rows,
          SessionHistory.decodeMessageRow,
        )
      }),
      context: Effect.fn("SessionStore.context")((sessionID) => SessionHistory.load(db, sessionID, "latest")),
      message: Effect.fn("SessionStore.message")(function* (messageID) {
        const row = yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.id, messageID))
          .get()
          .pipe(Effect.orDie)
        return row
          ? {
              sessionID: Session.ID.make(row.session_id),
              message: yield* SessionHistory.decodeMessageRow(row).pipe(Effect.orDie),
            }
          : undefined
      }),
      listSuspended: Effect.fn("SessionStore.listSuspended")(function* () {
        return yield* db
          .select({ sessionID: SessionTable.id, owner: SessionTable.execution_owner })
          .from(SessionTable)
          .where(and(isNotNull(SessionTable.time_suspended), isNull(SessionTable.parent_id)))
          .all()
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows.filter((row) => !ownedElsewhere(row.owner)).map((row) => row.sessionID)),
          )
      }),
      claim: Effect.fn("SessionStore.claim")(function* (sessionID) {
        // The null guard makes re-claiming a still-claimed Session a zero-row
        // no-op (a resumed turn re-claims through the same started hook).
        // Claim bookkeeping never counts as user activity: time_updated is
        // pinned so session ordering only moves on real changes.
        yield* db
          .update(SessionTable)
          .set({ time_suspended: Date.now(), time_updated: sql`${SessionTable.time_updated}` })
          .where(and(eq(SessionTable.id, sessionID), isNull(SessionTable.time_suspended)))
          .run()
          .pipe(Effect.orDie)
      }),
      release: Effect.fn("SessionStore.release")(function* (sessionID) {
        yield* db
          .update(SessionTable)
          .set({ time_suspended: null, resume_attempts: 0, time_updated: sql`${SessionTable.time_updated}` })
          .where(eq(SessionTable.id, sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
      releaseChildClaims: Effect.fn("SessionStore.releaseChildClaims")(function* (recoverable) {
        const rows = yield* db
          .select({ id: SessionTable.id, owner: SessionTable.execution_owner })
          .from(SessionTable)
          .where(
            and(
              isNotNull(SessionTable.time_suspended),
              isNotNull(SessionTable.parent_id),
              recoverable.length > 0 ? notInArray(SessionTable.id, Array.from(recoverable)) : undefined,
            ),
          )
          .all()
          .pipe(Effect.orDie)
        for (const row of rows) {
          if (row.owner && ExecutionOwner.alive(row.owner)) continue
          yield* db
            .update(SessionTable)
            .set({ time_suspended: null, resume_attempts: 0, time_updated: sql`${SessionTable.time_updated}` })
            .where(
              and(
                eq(SessionTable.id, row.id),
                row.owner === null ? isNull(SessionTable.execution_owner) : eq(SessionTable.execution_owner, row.owner),
              ),
            )
            .run()
            .pipe(Effect.orDie)
        }
      }),
      countResume: Effect.fn("SessionStore.countResume")(function* (sessionID) {
        const row = yield* db
          .update(SessionTable)
          .set({
            resume_attempts: sql`${SessionTable.resume_attempts} + 1`,
            time_updated: sql`${SessionTable.time_updated}`,
          })
          .where(eq(SessionTable.id, sessionID))
          .returning({ attempts: SessionTable.resume_attempts })
          .get()
          .pipe(Effect.orDie)
        return row?.attempts
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, FSUtil.node] })
