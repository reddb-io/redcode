export * as SessionUsageMirror from "./mirror.js"

import { asc, and, eq, gt, gte, isNull, or } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Schema, Stream } from "effect"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { UsageMirror } from "@opencode/schema/usage-mirror"
import { TokenUsage } from "@opencode/schema/token-usage"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { open, supported } from "#usage-sidecar"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { SessionEvent } from "../session/event.js"
import { SessionMessage } from "../session/message.js"
import { SessionMessageTable, SessionTable } from "../session/sql.js"
import { UsagePath } from "./path.js"
import type { Store } from "./sidecar.js"

type Row = Pick<typeof SessionMessageTable.$inferSelect, "id" | "session_id" | "time_created" | "time_updated" | "data">

const decodeAssistant = Schema.decodeUnknownOption(SessionMessage.Assistant)
const pageSize = 500

export interface Interface {
  readonly backfill: () => Effect.Effect<UsageMirror.Backfill, Error>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/UsageMirror") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const bus = yield* Bus.Service
    const global = yield* Global.Service
    const filename = UsagePath.sidecar(global.home)
    const openStore = Effect.fn("UsageMirror.open")(function* () {
      if (!supported) return yield* Effect.fail(new Error("Usage sidecar requires a local filesystem"))
      if (!UsagePath.enabled()) return yield* Effect.fail(new Error("Usage sidecar is disabled"))
      yield* Effect.tryPromise({
        try: () => mkdir(path.dirname(filename), { recursive: true }),
        catch: (cause) => new Error(`Cannot create usage directory: ${String(cause)}`),
      })
      return yield* Effect.try({
        try: () => open(filename),
        catch: (cause) => new Error(`Cannot open usage sidecar: ${String(cause)}`),
      })
    })

    const backfill = Effect.fn("UsageMirror.backfill")(function* () {
      const store = yield* openStore()
      return yield* Effect.gen(function* () {
        let cursor = SessionMessage.ID.make("msg_")
        let mirrored = 0
        let skipped = 0
        while (true) {
          const rows = yield* db
            .select({
              id: SessionMessageTable.id,
              session_id: SessionMessageTable.session_id,
              time_created: SessionMessageTable.time_created,
              time_updated: SessionMessageTable.time_updated,
              data: SessionMessageTable.data,
            })
            .from(SessionMessageTable)
            .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.session_id))
            .where(and(
              eq(SessionMessageTable.type, "assistant"),
              gt(SessionMessageTable.id, cursor),
              or(isNull(SessionTable.fork_session_id), gte(SessionMessageTable.time_created, SessionTable.time_created)),
            ))
            .orderBy(asc(SessionMessageTable.id))
            .limit(pageSize)
            .all()
            .pipe(Effect.orDie)
          if (!rows.length) break
          yield* Effect.forEach(rows, (row) => Effect.try({
            try: () => mirror(row, store),
            catch: (cause) => new Error(`Cannot write usage sidecar: ${String(cause)}`),
          }).pipe(Effect.map((written) => {
            if (written) mirrored++
            else skipped++
          })), { discard: true })
          cursor = rows.at(-1)!.id
        }
        return { sidecar: filename, mirrored, skipped } satisfies UsageMirror.Backfill
      }).pipe(Effect.ensuring(Effect.sync(() => store.close())))
    })

    if (supported) {
      let failed = false
      yield* bus.subscribe([SessionEvent.Step.Ended, SessionEvent.Step.Failed]).pipe(
        Stream.runForEach((event) => {
          if (failed || !UsagePath.enabled()) return Effect.void
          return Effect.gen(function* () {
            const row = yield* db
              .select({
                id: SessionMessageTable.id,
                session_id: SessionMessageTable.session_id,
                time_created: SessionMessageTable.time_created,
                time_updated: SessionMessageTable.time_updated,
                data: SessionMessageTable.data,
              })
              .from(SessionMessageTable)
              .where(and(eq(SessionMessageTable.id, event.data.assistantMessageID), eq(SessionMessageTable.type, "assistant")))
              .get()
              .pipe(Effect.orDie)
            if (!row) return
            const store = yield* openStore()
            yield* Effect.try({
              try: () => mirror(row, store),
              catch: (cause) => new Error(`Cannot write usage sidecar: ${String(cause)}`),
            }).pipe(Effect.ensuring(Effect.sync(() => store.close())))
          }).pipe(Effect.catch((error) => Effect.sync(() => { failed = true }).pipe(
            Effect.andThen(Effect.logWarning("usage sidecar disabled after write failure", { error })),
          )))
        }),
        Effect.forkScoped({ startImmediately: true }),
      )
    }

    return Service.of({ backfill })
  }),
)

function mirror(row: Row, store: Store) {
  const info = Option.getOrUndefined(decodeAssistant({ ...row.data, id: row.id, type: "assistant" }))
  if (!info || (info.cost ?? 0) === 0 && (!info.tokens || TokenUsage.total(info.tokens) === 0)) return false
  const created = DateTime.toEpochMillis(info.time.created)
  const completed = info.time.completed ? DateTime.toEpochMillis(info.time.completed) : undefined
  store.put({
    id: row.id,
    sessionID: row.session_id,
    timeCreated: row.time_created,
    timeUpdated: completed ?? row.time_updated,
    data: JSON.stringify({
      id: row.id,
      sessionID: row.session_id,
      role: "assistant",
      modelID: info.model.id,
      providerID: info.model.providerID,
      cost: info.cost,
      tokens: info.tokens,
      time: { created, completed },
    }),
  })
  return true
}

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, Bus.node, Global.node] })
