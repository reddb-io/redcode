export * as SessionProjector from "./projector"

import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm"
import { DateTime, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"
import { SessionEvent } from "./event"
import { SessionV1 } from "../v1/session"
import { WorkspaceTable } from "../control-plane/workspace.sql"
import { SessionMessage } from "./message"
import { SessionLegacyMessage } from "./legacy-message"
import { SessionMessageUpdater } from "./message-updater"
import { SessionInput } from "./input"
import { WorkspaceV2 } from "../workspace"
import { Usage } from "../usage/usage"
import {
  MessageTable,
  PartTable,
  SessionContextEpochTable,
  SessionGuardTripTable,
  SessionInputTable,
  SessionMessageTable,
  SessionTable,
  TodoHistoryTable,
  TodoTable,
} from "./sql"
import type { DeepMutable } from "../schema"
import { MonitorTable } from "../monitor.sql"
import { SessionGoalReviewTable, SessionGoalTable, SessionPlanTable } from "./goal.sql"
import { SessionShareTable } from "../share/sql"
import { IntelligenceEvaluationTable } from "../intelligence.sql"
import { SessionSchema } from "./schema"

type DatabaseService = Database.Interface["db"]

const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)
const encodeMessage = Schema.encodeSync(SessionMessage.Message)

export class SessionAlreadyProjected extends Error {}

type Usage = {
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

function usage(part: (typeof SessionV1.Event.PartUpdated.Type)["data"]["part"] | unknown): Usage | undefined {
  if (typeof part !== "object" || part === null) return undefined
  const value = part as Record<string, unknown>
  if (value.type !== "step-finish") return undefined
  if (!("cost" in value) || !("tokens" in value)) return undefined
  return { cost: value.cost as Usage["cost"], tokens: value.tokens as Usage["tokens"] }
}

function sessionRow(info: SessionV1.SessionInfo): typeof SessionTable.$inferInsert {
  return {
    id: info.id,
    project_id: info.projectID,
    workspace_id: info.workspaceID ?? null,
    parent_id: info.parentID,
    slug: info.slug,
    directory: info.directory,
    path: info.path,
    title: info.title,
    agent: info.agent,
    model: info.model,
    version: info.version,
    share_url: info.share?.url,
    summary_additions: info.summary?.additions,
    summary_deletions: info.summary?.deletions,
    summary_files: info.summary?.files,
    summary_diffs: info.summary?.diffs ? [...info.summary.diffs] : undefined,
    metadata: info.metadata,
    cost: info.cost ?? 0,
    tokens_input: (info.tokens ?? { input: 0 }).input,
    tokens_output: (info.tokens ?? { output: 0 }).output,
    tokens_reasoning: (info.tokens ?? { reasoning: 0 }).reasoning,
    tokens_cache_read: (info.tokens ?? { cache: { read: 0 } }).cache.read,
    tokens_cache_write: (info.tokens ?? { cache: { write: 0 } }).cache.write,
    revert: info.revert ? { ...info.revert, messageID: SessionMessage.ID.make(info.revert.messageID) } : null,
    permission: info.permission ? [...info.permission] : undefined,
    time_created: info.time.created,
    time_updated: info.time.updated,
    // Null, not undefined: an update skips undefined columns, and the mark has to clear.
    time_compacting: info.time.compacting ?? null,
    time_archived: info.time.archived,
  }
}

let warnedAboutSidecar = false

function messageData(
  info: (typeof SessionV1.Event.MessageUpdated.Type)["data"]["info"],
): typeof MessageTable.$inferInsert.data {
  const { id: _, sessionID: __, ...rest } = info
  return rest as DeepMutable<typeof rest>
}

function partData(part: (typeof SessionV1.Event.PartUpdated.Type)["data"]["part"]): typeof PartTable.$inferInsert.data {
  const { id: _, messageID: __, sessionID: ___, ...rest } = part
  return rest as DeepMutable<typeof rest>
}

function applyUsage(
  db: DatabaseService,
  sessionID: (typeof SessionV1.Event.MessageUpdated.Type)["data"]["sessionID"],
  value: Usage,
  sign = 1,
) {
  return db
    .update(SessionTable)
    .set({
      cost: sql`${SessionTable.cost} + ${value.cost * sign}`,
      tokens_input: sql`${SessionTable.tokens_input} + ${value.tokens.input * sign}`,
      tokens_output: sql`${SessionTable.tokens_output} + ${value.tokens.output * sign}`,
      tokens_reasoning: sql`${SessionTable.tokens_reasoning} + ${value.tokens.reasoning * sign}`,
      tokens_cache_read: sql`${SessionTable.tokens_cache_read} + ${value.tokens.cache.read * sign}`,
      tokens_cache_write: sql`${SessionTable.tokens_cache_write} + ${value.tokens.cache.write * sign}`,
      time_updated: sql`${SessionTable.time_updated}`,
    })
    .where(eq(SessionTable.id, sessionID))
    .run()
    .pipe(Effect.orDie)
}

function run(db: DatabaseService, events: EventV2.Interface, event: SessionEvent.Event) {
  return Effect.gen(function* () {
    const decodeRow = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type })
    const updateMessage = (message: SessionMessage.Message) => {
      if (event.durable === undefined) return Effect.die("Durable Session event is missing aggregate sequence")
      const encoded = encodeMessage(message)
      const { id, type, ...data } = encoded
      return db
        .update(SessionMessageTable)
        .set({ type, time_created: DateTime.toEpochMillis(message.time.created), data })
        .where(
          and(
            eq(SessionMessageTable.id, SessionMessage.ID.make(id)),
            eq(SessionMessageTable.session_id, event.data.sessionID),
          ),
        )
        .run()
        .pipe(Effect.orDie)
    }
    const appendMessage = (message: SessionMessage.Message) => insertMessage(db, event, message)
    const adapter: SessionMessageUpdater.Adapter = {
      getCurrentAssistant() {
        return Effect.gen(function* () {
          // A newer turn supersedes stale incomplete rows; never resume an older assistant projection.
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.type, "assistant")),
            )
            .orderBy(desc(SessionMessageTable.seq))
            .limit(1)
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const message = decodeRow(row)
          return message.type === "assistant" && !message.time.completed ? message : undefined
        })
      },
      getAssistant(messageID) {
        return Effect.gen(function* () {
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.id, messageID),
                eq(SessionMessageTable.session_id, event.data.sessionID),
                eq(SessionMessageTable.type, "assistant"),
              ),
            )
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const message = decodeRow(row)
          return message.type === "assistant" ? message : undefined
        })
      },
      getCurrentShell(callID) {
        return Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(SessionMessageTable)
            .where(and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.type, "shell")))
            .orderBy(desc(SessionMessageTable.seq))
            .all()
            .pipe(Effect.orDie)
          return rows
            .map(decodeRow)
            .find((message): message is SessionMessage.Shell => message.type === "shell" && message.callID === callID)
        })
      },
      updateAssistant: updateMessage,
      updateShell: updateMessage,
      appendMessage,
    }
    yield* SessionMessageUpdater.update(adapter, event)
    yield* mirrorLegacy(db, events, event)
  })
}

/**
 * The V2 → V1 mirror: republishes the materialized V2 message as the `SessionV1.Event.*` wire
 * events the current clients render, so the V2 runner can drive sessions before the clients read
 * the V2 surface. The projector's own V1 handlers write the mirror into `MessageTable`/`PartTable`
 * from these events. Removed together with the V1 read path at the end of the cutover.
 */
function mirrorLegacy(db: DatabaseService, events: EventV2.Interface, event: SessionEvent.Event) {
  const data = event.data as { readonly sessionID: SessionSchema.ID } & Record<string, unknown>
  const messageID =
    typeof data.messageID === "string"
      ? data.messageID
      : typeof data.assistantMessageID === "string"
        ? data.assistantMessageID
        : undefined
  if (messageID === undefined) return Effect.void
  return Effect.gen(function* () {
    const row = yield* db
      .select()
      .from(SessionMessageTable)
      .where(and(eq(SessionMessageTable.id, SessionMessage.ID.make(messageID)), eq(SessionMessageTable.session_id, data.sessionID)))
      .get()
      .pipe(Effect.orDie)
    if (!row) return
    const message = yield* Schema.decodeUnknownEffect(SessionMessage.Message)({ ...row.data, id: row.id, type: row.type }).pipe(Effect.orDie)
    const session = yield* db
      .select({ agent: SessionTable.agent, model: SessionTable.model, directory: SessionTable.directory, path: SessionTable.path })
      .from(SessionTable)
      .where(eq(SessionTable.id, data.sessionID))
      .get()
      .pipe(Effect.orDie)
    if (!session) return
    const parentID =
      message.type === "assistant"
        ? (
            yield* db
              .select({ id: SessionMessageTable.id })
              .from(SessionMessageTable)
              .where(and(eq(SessionMessageTable.session_id, data.sessionID), eq(SessionMessageTable.type, "user")))
              .orderBy(desc(SessionMessageTable.seq))
              .limit(1)
              .get()
              .pipe(Effect.orDie)
          )?.id
        : undefined
    const legacy = SessionLegacyMessage.toLegacy(message, {
      sessionID: data.sessionID,
      agent: session.agent ?? "build",
      model: session.model
        ? { providerID: session.model.providerID, modelID: session.model.id }
        : { providerID: "", modelID: "" },
      path: { cwd: session.directory, root: session.path ?? session.directory },
    }, parentID ? { parentID } : undefined)
    if (!legacy) return
    // The mirror writes the V1 read-path tables directly and republishes the live-only V1 wire
    // events for the clients' SSE. Publishing into the durable log here would collide with the V2
    // runner's sequence.
    const time_created = DateTime.toEpochMillis(message.time.created)
    const infoData = { ...legacy.info } as Record<string, unknown>
    delete infoData.id
    delete infoData.sessionID
    yield* db
      .insert(MessageTable)
      .values({ id: legacy.info.id, session_id: data.sessionID, time_created, data: infoData as unknown as typeof MessageTable.$inferInsert.data })
      .onConflictDoUpdate({
        target: MessageTable.id,
        set: { data: infoData, time_created: sql`max(${MessageTable.time_created}, excluded.time_created)` },
      })
      .run()
      .pipe(Effect.orDie)
    const time = Date.now()
    for (const part of legacy.parts) {
      const partData = { ...part } as Record<string, unknown>
      delete partData.id
      delete partData.messageID
      delete partData.sessionID
      yield* db
        .insert(PartTable)
        .values({ id: part.id, message_id: legacy.info.id, session_id: data.sessionID, time_created: time, data: partData as unknown as typeof PartTable.$inferInsert.data })
        .onConflictDoUpdate({ target: PartTable.id, set: { data: partData } })
        .run()
        .pipe(Effect.orDie)
      yield* events.publish(SessionLegacyMessage.PartUpdated, { sessionID: data.sessionID, part, time })
    }
    yield* events.publish(SessionLegacyMessage.MessageUpdated, { sessionID: data.sessionID, info: legacy.info })
  })
}

function insertMessage(db: DatabaseService, event: SessionEvent.Event, message: SessionMessage.Message) {
  if (event.durable === undefined) return Effect.die("Durable Session event is missing aggregate sequence")
  const encoded = encodeMessage(message)
  const { id, type, ...data } = encoded
  return db
    .insert(SessionMessageTable)
    .values({
      id: SessionMessage.ID.make(id),
      session_id: event.data.sessionID,
      type,
      seq: event.durable.seq,
      time_created: DateTime.toEpochMillis(message.time.created),
      data,
    })
    .run()
    .pipe(Effect.orDie)
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service
    yield* events.project(SessionV1.Event.Created, (event) =>
      Effect.gen(function* () {
        const stored = yield* db
          .insert(SessionTable)
          .values(sessionRow(event.data.info))
          .onConflictDoNothing()
          .returning({ sessionID: SessionTable.id })
          .get()
          .pipe(Effect.orDie)
        if (!stored) return yield* Effect.die(new SessionAlreadyProjected())
        if (event.data.info.workspaceID) {
          yield* db
            .update(WorkspaceTable)
            .set({ time_used: Date.now() })
            .where(eq(WorkspaceTable.id, event.data.info.workspaceID))
            .run()
            .pipe(Effect.orDie)
        }
      }),
    )
    yield* events.project(SessionV1.Event.Updated, (event) =>
      db
        .update(SessionTable)
        .set(sessionRow(event.data.info))
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie),
    )
    yield* events.project(SessionEvent.Moved, (event) =>
      Effect.gen(function* () {
        yield* db
          .update(SessionTable)
          .set({
            directory: event.data.location.directory,
            path: event.data.subdirectory,
            workspace_id: event.data.location.workspaceID ? WorkspaceV2.ID.make(event.data.location.workspaceID) : null,
            time_updated: DateTime.toEpochMillis(event.data.timestamp),
          })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionV1.Event.Deleted, (event) => deleteSession(db, event.data.sessionID))
    yield* events.project(SessionV1.Event.MessageUpdated, (event) =>
      Effect.gen(function* () {
        const time_created = event.data.info.time.created
        const id = event.data.info.id
        const sessionID = event.data.info.sessionID
        const data = messageData(event.data.info)
        // `data` is overwritten by every publication, but `time_created` only moves forward: a V1
        // Prompt Promotion re-stamps the stored user message so it takes its place in history at
        // promotion time, not at admission, while a stale or reordered publication can never move
        // a message earlier than it already is.
        yield* db
          .insert(MessageTable)
          .values({ id, session_id: sessionID, time_created, data })
          .onConflictDoUpdate({
            target: MessageTable.id,
            set: { data, time_created: sql`max(${MessageTable.time_created}, excluded.time_created)` },
          })
          .run()
          .pipe(Effect.orDie)
        // The usage sidecar mirrors the same row, minus the content: it is the file usage reporters read, and it
        // outlives whatever stores the session itself (Usage.record swallows its own failures).
        const mirrored = Usage.recordMessage({ id, sessionID, timeCreated: time_created, info: event.data.info })
        if (mirrored === false && !warnedAboutSidecar) {
          warnedAboutSidecar = true
          yield* Effect.logWarning("usage sidecar disabled after a write failure", { error: Usage.lastError() })
        }
      }),
    )
    // The durable, replayed fact of a V1 Prompt Promotion (sync and steal replay the aggregate
    // into a fresh projection, and commit hooks are not replayed). Idempotent: a row already
    // stamped, or absent, is left alone.
    yield* events.project(SessionV1.Event.MessagePromoted, (event) =>
      Effect.gen(function* () {
        if (event.durable === undefined) return yield* Effect.die("Durable Session event is missing aggregate sequence")
        yield* SessionInput.projectLegacyPromotion(db, {
          id: SessionMessage.ID.make(event.data.messageID),
          sessionID: event.data.sessionID,
          promotedSeq: event.durable.seq,
        })
      }),
    )
    yield* events.project(SessionV1.Event.MessageRemoved, (event) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(PartTable)
          .where(and(eq(PartTable.message_id, event.data.messageID), eq(PartTable.session_id, event.data.sessionID)))
          .all()
          .pipe(Effect.orDie)
        for (const row of rows) {
          const previous = usage(row.data)
          if (previous) yield* applyUsage(db, event.data.sessionID, previous, -1)
        }
        yield* db
          .delete(MessageTable)
          .where(and(eq(MessageTable.id, event.data.messageID), eq(MessageTable.session_id, event.data.sessionID)))
          .run()
          .pipe(Effect.orDie)
        // A removed V1 user message (revert) can never be promoted; its pending inbox row goes with it.
        yield* db
          .delete(SessionInputTable)
          .where(
            and(
              eq(SessionInputTable.id, SessionMessage.ID.make(event.data.messageID)),
              eq(SessionInputTable.session_id, event.data.sessionID),
              isNull(SessionInputTable.promoted_seq),
            ),
          )
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionV1.Event.PartRemoved, (event) =>
      Effect.gen(function* () {
        const row = yield* db
          .select()
          .from(PartTable)
          .where(and(eq(PartTable.id, event.data.partID), eq(PartTable.session_id, event.data.sessionID)))
          .get()
          .pipe(Effect.orDie)
        const previous = row && usage(row.data)
        if (previous) yield* applyUsage(db, event.data.sessionID, previous, -1)
        yield* db
          .delete(PartTable)
          .where(and(eq(PartTable.id, event.data.partID), eq(PartTable.session_id, event.data.sessionID)))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionV1.Event.PartUpdated, (event) =>
      Effect.gen(function* () {
        const id = event.data.part.id
        const messageID = event.data.part.messageID
        const sessionID = event.data.part.sessionID
        const data = partData(event.data.part)
        const row = yield* db.select().from(PartTable).where(eq(PartTable.id, id)).get().pipe(Effect.orDie)
        yield* db
          .insert(PartTable)
          .values({ id, message_id: messageID, session_id: sessionID, time_created: event.data.time, data })
          .onConflictDoUpdate({ target: PartTable.id, set: { data } })
          .run()
          .pipe(Effect.orDie)
        const previous = row && usage(row.data)
        const next = usage(event.data.part)
        if (previous) yield* applyUsage(db, row.session_id, previous, -1)
        if (next) yield* applyUsage(db, sessionID, next)
      }),
    )
    yield* events.project(SessionEvent.AgentSwitched, (event) =>
      db
        .update(SessionTable)
        .set({ agent: event.data.agent, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie, Effect.andThen(run(db, events, event))),
    )
    yield* events.project(SessionEvent.ModelSwitched, (event) =>
      Effect.gen(function* () {
        yield* db
          .update(SessionTable)
          .set({ model: event.data.model, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
        yield* run(db, events, event)
      }),
    )
    yield* events.project(SessionEvent.Prompted, (event) =>
      Effect.gen(function* () {
        if (event.durable === undefined) return yield* Effect.die("Durable Session event is missing aggregate sequence")
        yield* SessionInput.projectPrompted(db, {
          id: event.data.messageID,
          sessionID: event.data.sessionID,
          prompt: event.data.prompt,
          delivery: event.data.delivery,
          timeCreated: event.data.timestamp,
          promotedSeq: event.durable.seq,
        })
        yield* run(db, events, event)
      }),
    )
    yield* events.project(SessionEvent.PromptAdmitted, (event) =>
      Effect.gen(function* () {
        if (event.durable === undefined) return yield* Effect.die("Durable Session event is missing aggregate sequence")
        yield* SessionInput.projectAdmitted(db, {
          admittedSeq: event.durable.seq,
          id: event.data.messageID,
          sessionID: event.data.sessionID,
          prompt: event.data.prompt,
          delivery: event.data.delivery,
          timeCreated: event.data.timestamp,
        })
      }),
    )
    yield* events.project(SessionEvent.PromptDeliveryChanged, (event) =>
      SessionInput.projectDeliveryChanged(db, {
        id: event.data.messageID,
        sessionID: event.data.sessionID,
        delivery: event.data.delivery,
      }),
    )
    yield* events.project(SessionEvent.ContextUpdated, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Synthetic, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Shell.Started, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Shell.Ended, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Step.Started, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Step.Ended, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Step.Failed, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Text.Started, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Text.Ended, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Tool.Input.Started, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Tool.Input.Ended, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Tool.Called, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Tool.Progress, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Tool.Success, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Tool.Failed, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Reasoning.Started, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Reasoning.Ended, (event) => run(db, events, event))
    // yield* events.project(SessionEvent.Retried, (event) => run(db, events, event))
    yield* events.project(SessionEvent.Compaction.Ended, (event) => run(db, events, event))
    yield* events.project(SessionEvent.RevertEvent.Staged, (event) =>
      db
        .update(SessionTable)
        .set({
          revert: { ...event.data.revert, files: event.data.revert.files ? [...event.data.revert.files] : undefined },
          time_updated: DateTime.toEpochMillis(event.data.timestamp),
        })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie, Effect.asVoid),
    )
    yield* events.project(SessionEvent.RevertEvent.Cleared, (event) =>
      db
        .update(SessionTable)
        .set({ revert: null, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie, Effect.asVoid),
    )
    yield* events.project(SessionEvent.RevertEvent.Committed, (event) =>
      Effect.gen(function* () {
        const boundary = yield* db
          .select({ seq: SessionMessageTable.seq })
          .from(SessionMessageTable)
          .where(
            and(
              eq(SessionMessageTable.session_id, event.data.sessionID),
              eq(SessionMessageTable.id, event.data.messageID),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (!boundary) return yield* Effect.die(`Revert boundary message not found: ${event.data.messageID}`)
        yield* db
          .delete(SessionMessageTable)
          .where(
            and(eq(SessionMessageTable.session_id, event.data.sessionID), gt(SessionMessageTable.seq, boundary.seq)),
          )
          .run()
          .pipe(Effect.orDie)
        yield* db
          .delete(SessionInputTable)
          .where(
            and(
              eq(SessionInputTable.session_id, event.data.sessionID),
              or(gt(SessionInputTable.admitted_seq, boundary.seq), gt(SessionInputTable.promoted_seq, boundary.seq)),
            ),
          )
          .run()
          .pipe(Effect.orDie)
        yield* db
          .update(SessionTable)
          .set({ revert: null, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
  }),
)

export const node = makeGlobalNode({ name: "session-projector", layer, deps: [EventV2.node, Database.node] })

function deleteSession(db: DatabaseService, sessionID: SessionSchema.ID) {
  return db
    .transaction((tx) =>
      Effect.gen(function* () {
        // RedDB does not implement foreign keys yet, so mirror the SQLite cascade explicitly.
        yield* tx
          .update(IntelligenceEvaluationTable)
          .set({ session_id: null })
          .where(eq(IntelligenceEvaluationTable.session_id, sessionID))
          .run()
        yield* tx.delete(PartTable).where(eq(PartTable.session_id, sessionID)).run()
        yield* tx.delete(MessageTable).where(eq(MessageTable.session_id, sessionID)).run()
        yield* tx.delete(SessionMessageTable).where(eq(SessionMessageTable.session_id, sessionID)).run()
        yield* tx.delete(SessionInputTable).where(eq(SessionInputTable.session_id, sessionID)).run()
        yield* tx.delete(SessionContextEpochTable).where(eq(SessionContextEpochTable.session_id, sessionID)).run()
        yield* tx.delete(TodoHistoryTable).where(eq(TodoHistoryTable.session_id, sessionID)).run()
        yield* tx.delete(TodoTable).where(eq(TodoTable.session_id, sessionID)).run()
        yield* tx.delete(MonitorTable).where(eq(MonitorTable.session_id, sessionID)).run()
        yield* tx.delete(SessionGoalReviewTable).where(eq(SessionGoalReviewTable.session_id, sessionID)).run()
        yield* tx.delete(SessionGoalTable).where(eq(SessionGoalTable.session_id, sessionID)).run()
        yield* tx.delete(SessionPlanTable).where(eq(SessionPlanTable.session_id, sessionID)).run()
        yield* tx.delete(SessionShareTable).where(eq(SessionShareTable.session_id, sessionID)).run()
        yield* tx.delete(SessionGuardTripTable).where(eq(SessionGuardTripTable.session_id, sessionID)).run()
        yield* tx.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
      }),
    )
    .pipe(Effect.orDie)
}
