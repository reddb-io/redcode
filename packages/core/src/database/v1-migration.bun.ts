export * as V1Migration from "./v1-migration.js"

import { Cause, Effect, Layer, Semaphore } from "effect"
import { Database } from "./database.js"
import { SessionMessageTable, SessionTable } from "../session/sql.js"
import { SessionMessage } from "../session/message.js"
import { SessionSchema } from "../session/schema.js"
import { KVTable } from "../kv/sql.js"
import { AccountTable, AccountStateTable } from "../account/sql.js"
import { CredentialTable } from "../credential/sql.js"
import { SessionShareTable } from "../session/redcode.sql.js"
import { Credential } from "@opencode/schema/credential"
import { Integration } from "@opencode/schema/integration"
import { EventSequenceTable } from "../event/sql.js"
import { eq, sql } from "drizzle-orm"
import { Global } from "@opencode/util/global"
import { existsSync } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import type { Database as SQLiteDatabase } from "bun:sqlite"
import { Project } from "@opencode/schema/project"
import { transformSession, type SourceMessage, type SourcePart } from "./v1-transform.js"

export { transformSession } from "./v1-transform.js"
export type { SourceMessage, SourcePart, TransformInput, TransformResult, Warning } from "./v1-transform.js"

type Progress = {
  readonly label: string
  readonly numerator?: number
  readonly denominator?: number
}

export type Status =
  | { readonly status: "required" | "completed" }
  | { readonly status: "running"; readonly progress: Progress }
  | { readonly status: "error"; readonly error: string }

type RunResult = {
  readonly status: "completed"
}

type Options = {
  readonly nextDatabasePath?: string
}

type MigrationState = { readonly phase: "sessions"; readonly cursor?: string } | { readonly phase: "completed" }

type RuntimeState =
  | { readonly status: "idle" }
  | { readonly status: "running"; readonly progress: Progress }
  | { readonly status: "error"; readonly error: string }

type NextProject = {
  readonly id: string
  readonly worktree: string
  readonly vcs: string | null
  readonly name: string | null
  readonly icon_url: string | null
  readonly icon_url_override: string | null
  readonly icon_color: string | null
  readonly time_created: number
  readonly time_updated: number
  readonly time_initialized: number | null
  readonly sandboxes: string
  readonly commands: string | null
}

type NextColumns<A> = Record<keyof A, "required" | "nullable" | { readonly fallback: keyof A & string }>

const NEXT_PROJECT_COLUMNS = {
  id: "required",
  worktree: "required",
  vcs: "nullable",
  name: "nullable",
  icon_url: "nullable",
  icon_url_override: { fallback: "icon_url" },
  icon_color: "nullable",
  time_created: "required",
  time_updated: "required",
  time_initialized: "nullable",
  sandboxes: "required",
  commands: "nullable",
} satisfies NextColumns<NextProject>

type NextSession = {
  readonly id: string
  readonly project_id: string
  readonly workspace_id: string | null
  readonly parent_id: string | null
  readonly fork_session_id: string | null
  readonly fork_boundary: string | null
  readonly slug: string
  readonly directory: string
  readonly path: string | null
  readonly title: string | null
  readonly version: string
  readonly share_url: string | null
  readonly summary_additions: number | null
  readonly summary_deletions: number | null
  readonly summary_files: number | null
  readonly summary_diffs: string | null
  readonly metadata: string | null
  readonly cost: number
  readonly tokens_input: number
  readonly tokens_output: number
  readonly tokens_reasoning: number
  readonly tokens_cache_read: number
  readonly tokens_cache_write: number
  readonly revert: string | null
  readonly permission: string | null
  readonly agent: string | null
  readonly model: string | null
  readonly time_created: number
  readonly time_updated: number
  readonly time_compacting: number | null
  readonly time_archived: number | null
  readonly time_suspended: number | null
}

const NEXT_SESSION_COLUMNS = {
  id: "required",
  project_id: "required",
  workspace_id: "nullable",
  parent_id: "nullable",
  fork_session_id: "nullable",
  fork_boundary: "nullable",
  slug: "required",
  directory: "required",
  path: "nullable",
  title: "nullable",
  version: "required",
  share_url: "nullable",
  summary_additions: "nullable",
  summary_deletions: "nullable",
  summary_files: "nullable",
  summary_diffs: "nullable",
  metadata: "nullable",
  cost: "required",
  tokens_input: "required",
  tokens_output: "required",
  tokens_reasoning: "required",
  tokens_cache_read: "required",
  tokens_cache_write: "required",
  revert: "nullable",
  permission: "nullable",
  agent: "nullable",
  model: "nullable",
  time_created: "required",
  time_updated: "required",
  time_compacting: "nullable",
  time_archived: "nullable",
  time_suspended: "nullable",
} satisfies NextColumns<NextSession>

type NextMessage = {
  readonly id: string
  readonly session_id: string
  readonly type: string
  readonly seq: number
  readonly time_created: number
  readonly time_updated: number
  readonly data: string
}

type SourceValue = string | number | null
type SourceRow = Record<string, SourceValue>

const REDCODE_TABLES = [
  {
    name: "credential",
    columns: [
      "id",
      "integration_id",
      "label",
      "value",
      "connector_id",
      "method_id",
      "active",
      "time_created",
      "time_updated",
    ],
    key: ["id"],
  },
  {
    name: "project_directory",
    columns: ["project_id", "directory", "type", "strategy", "time_created"],
    key: ["project_id", "directory"],
  },
  {
    name: "permission",
    columns: ["id", "project_id", "action", "resource", "time_created", "time_updated"],
    key: ["id"],
  },
  {
    name: "session_input",
    target: "redcode_session_input",
    columns: ["id", "session_id", "prompt", "delivery", "admitted_seq", "promoted_seq", "time_created"],
    key: ["id"],
  },
  {
    name: "session_context_epoch",
    target: "redcode_session_context_epoch",
    columns: ["session_id", "baseline", "snapshot", "baseline_seq", "replacement_seq"],
    key: ["session_id"],
  },
  { name: "session_monitor", columns: ["id", "session_id", "owner", "data"], key: ["id"] },
  { name: "session_goal", columns: ["session_id", "goal_id", "revision", "owner", "data"], key: ["session_id"] },
  {
    name: "session_goal_review",
    columns: ["id", "session_id", "goal_id", "tokens", "created"],
    key: ["id"],
  },
  { name: "session_plan", columns: ["session_id", "revision", "created", "data"], key: ["session_id", "revision"] },
  {
    name: "todo",
    columns: [
      "session_id",
      "content",
      "status",
      "priority",
      "position",
      "task_id",
      "revision",
      "reason",
      "legacy_status",
      "details",
      "time_created",
      "time_updated",
    ],
    key: ["session_id", "position"],
  },
  {
    name: "todo_history",
    columns: ["session_id", "task_id", "revision", "data", "created"],
    key: ["session_id", "task_id", "revision"],
  },
  {
    name: "session_guard_trip",
    columns: ["id", "session_id", "guard", "action", "subject", "detail", "time_created", "time_updated"],
    key: ["id"],
  },
  {
    name: "session_share",
    columns: ["session_id", "id", "secret", "url", "time_created", "time_updated"],
    key: ["session_id"],
  },
  {
    name: "design_document",
    columns: ["id", "session_id", "directory", "data", "target", "platform"],
    key: ["id"],
  },
  { name: "design_revision", columns: ["id", "design_id", "created", "data"], key: ["id"] },
  { name: "design_feedback", columns: ["id", "design_id", "data", "admitted"], key: ["id"] },
  { name: "design_asset", columns: ["id", "design_id", "data"], key: ["id"] },
  { name: "design_render_job", columns: ["id", "design_id", "data"], key: ["id"] },
  {
    name: "intelligence_evaluation",
    columns: [
      "id",
      "session_id",
      "operation",
      "evaluation_kind",
      "subject_id",
      "candidate_id",
      "attempt",
      "fingerprint",
      "policy",
      "decision",
      "model",
      "evaluator",
      "issues",
      "input_tokens",
      "output_tokens",
      "duration",
      "artifact",
      "source_hash",
      "candidate_hash",
      "time_created",
    ],
    key: ["id"],
  },
  {
    name: "intelligence_answer",
    columns: [
      "evaluation_id",
      "question_id",
      "type",
      "noul",
      "choice",
      "score",
      "confidence",
      "probabilities",
      "legend",
    ],
    key: ["evaluation_id", "question_id"],
  },
] as const

const REDCODE_FALLBACKS: Record<string, Record<string, string>> = {
  credential: { connector_id: "NULL", method_id: "NULL", active: "NULL" },
  project_directory: { strategy: "NULL" },
  session_input: { promoted_seq: "NULL" },
  session_context_epoch: { replacement_seq: "NULL" },
  todo: {
    task_id: "NULL",
    revision: "1",
    reason: "NULL",
    legacy_status: "NULL",
    details: "NULL",
  },
  design_document: { target: "'web'", platform: "NULL" },
  intelligence_evaluation: { attempt: "0" },
}

export type RedcodeImportResult = {
  readonly imported: number
  readonly skipped: number
}

const lock = Semaphore.makeUnsafe(1)
const MIGRATION_STATE_KEY = "migration.v1-v2"
const EVENT_DELETE_BATCH_SIZE = 1_000
let runtimeState: RuntimeState = { status: "idle" }

export function status(): Effect.Effect<Status, never, Database.Service> {
  return Effect.gen(function* () {
    const database = yield* Database.Service
    if (database.remote) return { status: "completed" as const }
    const db = database.db
    if (!(yield* hasLegacySessions(db))) return { status: "completed" as const }
    const state = yield* readState(db)
    if (runtimeState.status === "running") return runtimeState
    if (runtimeState.status === "error") return runtimeState
    if (state?.phase === "completed") return { status: "completed" as const }
    return { status: "required" as const }
  })
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    runtimeState = { status: "running", progress: { label: "Clearing old events" } }
    yield* run().pipe(
      Effect.matchCauseEffect({
        onFailure: (cause) =>
          Effect.sync(() => {
            runtimeState = { status: "error", error: errorText(Cause.squash(cause)) }
          }).pipe(Effect.andThen(Effect.logError("V1 migration failed", { cause }))),
        onSuccess: () =>
          Effect.sync(() => {
            runtimeState = { status: "idle" }
          }),
      }),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
)

function errorText(input: unknown): string {
  if (!(input instanceof Error)) return String(input)
  const cause = input.cause
  return cause === undefined ? input.message : `${input.message}\nCaused by: ${errorText(cause)}`
}

function updateProgress(progress: Progress) {
  if (runtimeState.status === "running") runtimeState = { status: "running", progress }
}

export function run(options: Options = {}): Effect.Effect<RunResult, never, Database.Service | Global.Service> {
  return lock.withPermit(
    Effect.gen(function* () {
      const database = yield* Database.Service
      if (database.remote) return { status: "completed" as const }
      const db = database.db
      const global = yield* Global.Service
      yield* importNextAccounts(db, nextPath(options, global.data))
      yield* bridgeAccounts(db)
      const state = yield* readState(db)
      if (state?.phase === "completed") return { status: "completed" as const }
      if (!(yield* hasLegacySessions(db))) return { status: "completed" as const }
      const now = Date.now()
      yield* db.run(sql`
          INSERT OR IGNORE INTO project (id, worktree, time_created, time_updated, time_active, sandboxes)
          VALUES (${Project.ID.global}, ${path.parse(global.data).root}, ${now}, ${now}, ${now}, '[]')
        `)
      if (state === undefined)
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              while (true) {
                yield* tx.run(sql`
                    DELETE FROM event
                    WHERE rowid IN (SELECT rowid FROM event LIMIT ${EVENT_DELETE_BATCH_SIZE})
                  `)
                const deleted = (yield* tx.get<{ value: number }>(sql`SELECT changes() AS value`))?.value ?? 0
                if (deleted < EVENT_DELETE_BATCH_SIZE) break
                yield* Effect.yieldNow
              }
              yield* tx
                .insert(KVTable)
                .values({ key: MIGRATION_STATE_KEY, value: { phase: "sessions" } })
                .run()
            }),
          )
          .pipe(Effect.orDie)
      const sourceTotal = yield* countNextSessions(nextPath(options, global.data))
      const legacyTotal = (yield* db.get<{ value: number }>(sql`SELECT COUNT(*) AS value FROM session`))?.value ?? 0
      const cursor = state?.phase === "sessions" ? state.cursor : undefined
      const migrated =
        cursor !== undefined
          ? ((yield* db.get<{ value: number }>(sql`SELECT COUNT(*) AS value FROM session WHERE id >= ${cursor}`))
              ?.value ?? 0)
          : 0
      const denominator = sourceTotal + legacyTotal
      updateProgress({ label: "Migrating sessions", numerator: migrated, denominator })
      yield* importNextDatabase(db, nextPath(options, global.data), (completed) => {
        updateProgress({ label: "Migrating sessions", numerator: migrated + completed, denominator })
      })
      updateProgress({ label: "Migrating sessions", numerator: migrated + sourceTotal, denominator })
      const projects = new Set(
        (yield* db.all<{ id: string }>(sql`SELECT id FROM project`)).map((project) => project.id),
      )
      while (true) {
        const state = yield* readState(db)
        const cursorValue = state?.phase === "sessions" ? state.cursor : undefined
        const nextID = yield* db.get<{ id: string; project_id: string }>(
          cursorValue === undefined
            ? sql`SELECT id, project_id FROM session ORDER BY id DESC LIMIT 1`
            : sql`SELECT id, project_id FROM session WHERE id < ${cursorValue} ORDER BY id DESC LIMIT 1`,
        )
        if (!nextID) break
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .insert(KVTable)
                .values({ key: MIGRATION_STATE_KEY, value: { phase: "sessions", cursor: nextID.id } })
                .onConflictDoUpdate({
                  target: KVTable.key,
                  set: { value: { phase: "sessions", cursor: nextID.id }, time_updated: Date.now() },
                })
                .run()
              const projectID = projects.has(nextID.project_id) ? nextID.project_id : Project.ID.global
              if (projectID !== nextID.project_id)
                yield* Effect.logWarning("Reassigned V1 session with missing project", {
                  sessionID: nextID.id,
                  projectID: nextID.project_id,
                })
              yield* tx.run(sql`
                  INSERT OR IGNORE INTO session_v2 (
                    id, project_id, workspace_id, parent_id, slug, directory, path, title, version, share_url,
                    summary_additions, summary_deletions, summary_files, summary_diffs, metadata, cost,
                    tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
                    revert, permission, agent, model, time_created, time_updated, time_compacting, time_archived
                  )
                  SELECT
                    id, ${projectID}, workspace_id, parent_id, slug, directory, path, title, version, share_url,
                    summary_additions, summary_deletions, summary_files, summary_diffs, metadata, cost,
                    tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
                    revert, NULL, agent, model, time_created, time_updated, time_compacting, time_archived
                  FROM session
                  WHERE id = ${nextID.id}
                `)
              // The schema migration parks V1 tables with colliding V2 names.
              // Copy their session-owned rows only after the V2 parent exists.
              if (yield* tx.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'redcode_v1_session_share'`))
                yield* tx.run(sql`
                  INSERT OR IGNORE INTO session_share (session_id, id, secret, url, time_created, time_updated)
                  SELECT session_id, id, secret, url, time_created, time_updated
                  FROM redcode_v1_session_share WHERE session_id = ${nextID.id}
                `)
              if (yield* tx.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'redcode_v1_todo'`))
                yield* tx.run(sql`
                  INSERT OR IGNORE INTO todo (session_id, content, status, priority, position, time_created, time_updated)
                  SELECT session_id, content, status, priority, position, time_created, time_updated
                  FROM redcode_v1_todo WHERE session_id = ${nextID.id}
                `)
              const next = yield* tx
                .select()
                .from(SessionTable)
                .where(eq(SessionTable.id, SessionSchema.ID.make(nextID.id)))
                .get()
              if (!next) return yield* Effect.die(new Error(`Failed to copy V1 session ${nextID.id}`))
              const sourceMessages = yield* tx.all<SourceMessage>(
                sql`SELECT id, session_id, time_created, time_updated, data FROM message WHERE session_id = ${next.id}`,
              )
              const sourceParts = yield* tx.all<SourcePart>(
                sql`SELECT id, message_id, session_id, time_created, time_updated, data FROM part WHERE session_id = ${next.id}`,
              )
              const transformed = transformSession({ session: next, messages: sourceMessages, parts: sourceParts })
              yield* Effect.forEach(transformed.warnings, (warning) =>
                Effect.logWarning("Skipped V1 migration row", warning),
              )
              yield* tx.delete(SessionMessageTable).where(eq(SessionMessageTable.session_id, next.id)).run()
              yield* Effect.forEach(transformed.messages, (message) =>
                tx
                  .insert(SessionMessageTable)
                  .values({
                    id: SessionMessage.ID.make(message.id),
                    session_id: SessionSchema.ID.make(message.session_id),
                    type: message.type,
                    seq: message.seq,
                    time_created: message.time_created,
                    time_updated: message.time_updated,
                    data: sql`${JSON.stringify(message.data)}`,
                  })
                  .run(),
              )
              yield* tx
                .update(SessionTable)
                .set({ ...transformed.session, time_updated: next.time_updated })
                .where(eq(SessionTable.id, next.id))
                .run()
              yield* tx
                .insert(EventSequenceTable)
                .values({ aggregate_id: next.id, seq: transformed.watermark })
                .onConflictDoUpdate({
                  target: EventSequenceTable.aggregate_id,
                  set: { seq: transformed.watermark, owner_id: null },
                })
                .run()
            }),
          )
          .pipe(Effect.orDie)
        if (runtimeState.status === "running")
          runtimeState = {
            status: "running",
            progress: {
              label: "Migrating sessions",
              numerator: (runtimeState.progress.numerator ?? 0) + 1,
              denominator,
            },
          }
        yield* Effect.yieldNow
      }
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .insert(KVTable)
              .values({ key: MIGRATION_STATE_KEY, value: { phase: "completed" } })
              .onConflictDoUpdate({
                target: KVTable.key,
                set: { value: { phase: "completed" }, time_updated: Date.now() },
              })
              .run()
          }),
        )
        .pipe(Effect.orDie)
      return { status: "completed" as const }
    }).pipe(Effect.orDie),
  )
}

/** Import the old Redcode SQLite history without changing or migrating the source database. */
export function importRedcode(sourcePath: string): Effect.Effect<RedcodeImportResult, never, Database.Service> {
  return lock.withPermit(
    Effect.gen(function* () {
      if (!existsSync(sourcePath)) return yield* Effect.die(new Error(`Redcode database does not exist: ${sourcePath}`))
      const db = (yield* Database.Service).db
      const result = { imported: 0, skipped: 0 }
      yield* importNextDatabase(
        db,
        sourcePath,
        (_completed, imported) => {
          if (imported) result.imported++
          else result.skipped++
        },
        "redcode",
      )
      yield* importNextAccounts(db, sourcePath)
      yield* bridgeAccounts(db)
      return result
    }).pipe(Effect.orDie),
  )
}

/** Automatically adopt the prior Redcode database once; explicit imports remain repeatable. */
export function importRedcodeOnce(sourcePath: string) {
  return Effect.gen(function* () {
    if (!existsSync(sourcePath)) return
    const db = (yield* Database.Service).db
    const key = `migration.redcode-source:${createHash("sha256").update(sourcePath).digest("hex")}`
    if (yield* db.get<{ key: string }>(sql`SELECT key FROM kv WHERE key = ${key}`)) return
    const result = yield* importRedcode(sourcePath)
    yield* db.run(sql`
      INSERT OR IGNORE INTO kv (key, value, time_created, time_updated)
      VALUES (${key}, ${JSON.stringify(result)}, ${Date.now()}, ${Date.now()})
    `)
    yield* Effect.logInfo("Imported prior Redcode database", result)
  })
}

function nextPath(options: Options, data: string) {
  if (options.nextDatabasePath) return options.nextDatabasePath
  if (process.env.OPENCODE_DB === ":memory:") return undefined
  return path.join(data, "opencode-next.db")
}

function openNextDatabase(sourcePath: string) {
  return Effect.acquireRelease(
    Effect.gen(function* () {
      const sqlite = yield* Effect.promise(() => import("bun:sqlite"))
      return new sqlite.Database(sourcePath, { readonly: true, strict: true })
    }),
    (source) => Effect.sync(() => source.close()),
  )
}

function importNextAccounts(db: Database.Interface["db"], sourcePath: string | undefined) {
  if (!sourcePath || !existsSync(sourcePath)) return Effect.void
  const key = `redcode.accounts.imported:${createHash("sha256").update(sourcePath).digest("hex")}`
  return Effect.scoped(
    Effect.gen(function* () {
      const recorded = yield* db.select({ key: KVTable.key }).from(KVTable).where(eq(KVTable.key, key)).get()
      if (recorded) return
      const source = yield* openNextDatabase(sourcePath)
      const tables = new Set(
        source.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
      )
      if (!tables.has("account") || !tables.has("account_state")) return
      const accounts = source
        .query<typeof AccountTable.$inferSelect, []>(
          "SELECT id, email, url, access_token, refresh_token, token_expiry, time_created, time_updated FROM account",
        )
        .all()
      const stateColumns = new Set(
        source.query<{ name: string }, []>("PRAGMA table_info('account_state')").all().map((column) => column.name),
      )
      const state = source
        .query<typeof AccountStateTable.$inferSelect, []>(
          `SELECT id, active_account_id, ${stateColumns.has("active_org_id") ? "active_org_id" : "NULL AS active_org_id"} FROM account_state WHERE id = 1`,
        )
        .get()
      yield* db.transaction((tx) =>
        Effect.gen(function* () {
          if (accounts.length > 0)
            yield* tx.insert(AccountTable).values(accounts).onConflictDoNothing().run()
          if (state)
            yield* tx.insert(AccountStateTable).values(state).onConflictDoNothing().run()
          yield* tx.insert(KVTable).values({ key, value: true }).onConflictDoNothing().run()
        }),
      )
      yield* Effect.logInfo("Imported Redcode accounts", { count: accounts.length })
    }).pipe(Effect.orDie),
  )
}

function bridgeAccounts(db: Database.Interface["db"]) {
  return db.transaction((tx) =>
    Effect.gen(function* () {
      const accounts = yield* tx.select().from(AccountTable).all()
      if (accounts.length === 0) return
      const state = yield* tx.select().from(AccountStateTable).where(eq(AccountStateTable.id, 1)).get()
      const integrationID = Integration.ID.make("opencode")
      const existing = yield* tx.select().from(CredentialTable).where(eq(CredentialTable.integration_id, integrationID)).all()
      const hasActive = existing.some((credential) => credential.active)
      yield* Effect.forEach(accounts, (account) =>
        Effect.gen(function* () {
          const key = `redcode.account.credential:${createHash("sha256").update(`${account.id}\0${account.url}`).digest("hex")}`
          const imported = yield* tx.select({ key: KVTable.key }).from(KVTable).where(eq(KVTable.key, key)).get()
          const linked = existing.find((credential) =>
            credential.value.type === "oauth" &&
            credential.value.metadata?.accountID === account.id &&
            credential.value.metadata?.server === account.url,
          )
          const credentialID = linked?.id ?? (imported ? undefined : Credential.ID.create())
          if (!linked && credentialID) {
            const selected = state?.active_account_id === account.id
            yield* tx.insert(CredentialTable).values({
              id: credentialID,
              integration_id: integrationID,
              label: account.email,
              value: Credential.OAuth.make({
                type: "oauth",
                methodID: Integration.MethodID.make("device"),
                access: account.access_token,
                refresh: account.refresh_token,
                expires: Math.max(0, account.token_expiry ?? 0),
                metadata: {
                  server: account.url,
                  accountID: account.id,
                  email: account.email,
                  ...(selected && state?.active_org_id
                    ? { orgID: state.active_org_id, orgName: state.active_org_id }
                    : {}),
                },
              }),
              active: selected && !hasActive,
            }).run()
          }
          if (credentialID)
            yield* tx.update(SessionShareTable)
              .set({ credential_id: credentialID, resource: "shares" })
              .where(eq(SessionShareTable.account_id, account.id))
              .run()
          yield* tx.delete(AccountTable).where(eq(AccountTable.id, account.id)).run()
          if (!imported) yield* tx.insert(KVTable).values({ key, value: true }).run()
        }),
      )
    }),
  ).pipe(Effect.orDie)
}

function countNextSessions(sourcePath: string | undefined) {
  if (!sourcePath || !existsSync(sourcePath)) return Effect.succeed(0)
  return Effect.scoped(
    Effect.gen(function* () {
      const source = yield* openNextDatabase(sourcePath)
      if (!isNextDatabase(source)) return 0
      return source.query<{ value: number }, []>("SELECT COUNT(*) AS value FROM session").get()?.value ?? 0
    }),
  )
}

function importNextDatabase(
  db: Database.Interface["db"],
  sourcePath: string | undefined,
  onProgress: (completed: number, imported: boolean) => void,
  kind: "previous-v2" | "redcode" = "previous-v2",
): Effect.Effect<void, unknown> {
  if (!sourcePath || !existsSync(sourcePath)) return Effect.void
  return Effect.scoped(
    Effect.gen(function* () {
      const source = yield* openNextDatabase(sourcePath)
      if (!isNextDatabase(source)) {
        if (kind === "redcode")
          return yield* Effect.die(new Error(`Incompatible Redcode session database: ${sourcePath}`))
        yield* Effect.logWarning("Skipped incompatible session database", { path: sourcePath })
        return
      }
      if (kind === "redcode" && !hasLegacyMessages(source))
        return yield* Effect.die(new Error(`Redcode database has no V1 message and part tables: ${sourcePath}`))
      source.run("BEGIN")
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (source.inTransaction) source.run("ROLLBACK")
        }),
      )
      const projects = new Map(
        selectNextRows<NextProject>(source, "project", NEXT_PROJECT_COLUMNS).map((project) => [project.id, project]),
      )
      if (kind === "redcode")
        yield* db.transaction((tx) =>
          Effect.forEach(
            projects.values(),
            (project) =>
              Effect.gen(function* () {
                const existing = yield* tx.get<{ worktree: string }>(
                  sql`SELECT worktree FROM project WHERE id = ${project.id}`,
                )
                if (existing) {
                  if (existing.worktree !== project.worktree)
                    return yield* Effect.die(new Error(`Conflicting Redcode project ${project.id}`))
                  return
                }
                yield* tx.run(sql`
                  INSERT INTO project (
                    id, worktree, vcs, name, icon_url, icon_url_override, icon_color,
                    time_created, time_updated, time_initialized, time_active, sandboxes, commands
                  ) VALUES (
                    ${project.id}, ${project.worktree}, ${project.vcs}, ${project.name}, ${project.icon_url},
                    ${project.icon_url_override}, ${project.icon_color}, ${project.time_created}, ${project.time_updated},
                    ${project.time_initialized}, ${project.time_updated}, ${project.sandboxes}, ${project.commands}
                  )
                `)
              }),
            { discard: true },
          ),
        )
      const sessions = selectNextRows<NextSession>(source, "session", NEXT_SESSION_COLUMNS)
      for (const [index, session] of sessions.entries()) {
        const project = projects.get(session.project_id)
        const projectID = project ? session.project_id : Project.ID.global
        if (!project) {
          yield* Effect.logWarning("Reassigned imported session with missing project", {
            sessionID: session.id,
            projectID: session.project_id,
          })
        }
        const messages = source
          .query<
            NextMessage,
            [string]
          >("SELECT id, session_id, type, seq, time_created, time_updated, data FROM session_message WHERE session_id = ? ORDER BY seq")
          .all(session.id)
        const legacyMessages =
          kind === "redcode"
            ? source
                .query<
                  SourceMessage,
                  [string]
                >("SELECT id, session_id, time_created, time_updated, data FROM message WHERE session_id = ? ORDER BY time_created, id")
                .all(session.id)
            : []
        const legacyParts =
          kind === "redcode"
            ? source
                .query<
                  SourcePart,
                  [string]
                >("SELECT id, message_id, session_id, time_created, time_updated, data FROM part WHERE session_id = ? ORDER BY id")
                .all(session.id)
            : []
        const imported = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              if (!project)
                yield* tx.run(sql`
                  INSERT OR IGNORE INTO project (id, worktree, time_created, time_updated, time_active, sandboxes)
                  VALUES (${Project.ID.global}, ${path.parse(session.directory).root}, ${session.time_created},
                    ${session.time_updated}, ${session.time_updated}, '[]')
                `)
              if (project && kind !== "redcode")
                yield* tx.run(sql`
                  INSERT OR IGNORE INTO project (
                    id, worktree, vcs, name, icon_url, icon_url_override, icon_color,
                    time_created, time_updated, time_initialized, time_active, sandboxes, commands
                  ) VALUES (
                    ${project.id}, ${project.worktree}, ${project.vcs}, ${project.name}, ${project.icon_url},
                    ${project.icon_url_override}, ${project.icon_color}, ${project.time_created}, ${project.time_updated},
                    ${project.time_initialized}, ${project.time_updated}, ${project.sandboxes}, ${project.commands}
                  )
                `)
              const existing = yield* tx
                .select()
                .from(SessionTable)
                .where(eq(SessionTable.id, SessionSchema.ID.make(session.id)))
                .get()
              if (existing && kind !== "redcode") return false
              if (
                existing &&
                (existing.project_id !== projectID ||
                  existing.directory !== session.directory ||
                  existing.time_created !== session.time_created)
              )
                return yield* Effect.die(new Error(`Conflicting Redcode session ${session.id}`))
              if (!existing)
                yield* tx.run(sql`
                INSERT INTO session_v2 (
                  id, project_id, workspace_id, parent_id, fork_session_id, fork_boundary, slug, directory,
                  path, title, version, share_url, summary_additions, summary_deletions, summary_files,
                  summary_diffs, metadata, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read,
                  tokens_cache_write, revert, permission, agent, model, time_created, time_updated, time_compacting,
                  time_archived, time_suspended
                ) VALUES (
                  ${session.id}, ${projectID}, ${session.workspace_id}, ${session.parent_id},
                  ${session.fork_session_id}, ${session.fork_boundary}, ${session.slug}, ${session.directory},
                  ${session.path}, ${session.title}, ${session.version}, ${session.share_url},
                  ${session.summary_additions}, ${session.summary_deletions}, ${session.summary_files},
                  ${session.summary_diffs}, ${session.metadata}, ${session.cost}, ${session.tokens_input},
                  ${session.tokens_output}, ${session.tokens_reasoning}, ${session.tokens_cache_read},
                  ${session.tokens_cache_write}, ${session.revert}, ${session.permission}, ${session.agent},
                  ${session.model}, ${session.time_created}, ${session.time_updated}, ${session.time_compacting},
                  ${session.time_archived}, ${session.time_suspended}
                )
              `)
              const next =
                existing ??
                (yield* tx
                  .select()
                  .from(SessionTable)
                  .where(eq(SessionTable.id, SessionSchema.ID.make(session.id)))
                  .get())
              if (!next) return yield* Effect.die(new Error(`Failed to import Redcode session ${session.id}`))
              const legacy =
                legacyMessages.length === 0
                  ? undefined
                  : transformSession({ session: next, messages: legacyMessages, parts: legacyParts })
              if (kind === "redcode" && legacy?.warnings.length)
                return yield* Effect.die(
                  new Error(
                    `Redcode session ${session.id} has ${legacy.warnings.length} invalid V1 rows; ` +
                      `first: ${JSON.stringify(legacy.warnings[0])}`,
                  ),
                )
              yield* Effect.forEach(legacy?.warnings ?? [], (warning) =>
                Effect.logWarning("Skipped Redcode migration row", warning),
              )
              const history: NextMessage[] = legacy
                ? [
                    ...legacy.messages.map((message) => ({ ...message, data: JSON.stringify(message.data) })),
                    ...messages,
                  ]
                    .toSorted(
                      (left, right) =>
                        left.time_created - right.time_created ||
                        left.seq - right.seq ||
                        left.id.localeCompare(right.id),
                    )
                    .map((message, seq) => ({ ...message, seq }))
                : messages
              const ids = new Set(history.map((message) => message.id))
              if (ids.size !== history.length)
                return yield* Effect.die(new Error(`Duplicate message IDs in Redcode session ${session.id}`))
              if (existing) {
                const current = new Map(
                  (yield* tx.all<{ id: string; type: string; time_created: number; data: string }>(sql`
                    SELECT id, type, time_created, data FROM session_message WHERE session_id = ${session.id}
                  `)).map((message) => [message.id, message]),
                )
                const conflicting = history.find((message) => {
                  const found = current.get(message.id)
                  return (
                    !found ||
                    found.type !== message.type ||
                    found.time_created !== message.time_created ||
                    found.data !== message.data
                  )
                })
                if (conflicting)
                  return yield* Effect.die(
                    new Error(`Conflicting Redcode history in session ${session.id}: ${conflicting.id}`),
                  )
                return false
              }
              yield* Effect.forEach(history, (message) =>
                tx
                  .insert(SessionMessageTable)
                  .values({
                    id: SessionMessage.ID.make(message.id),
                    session_id: SessionSchema.ID.make(message.session_id),
                    type: message.type as SessionMessage.Type,
                    seq: message.seq,
                    time_created: message.time_created,
                    time_updated: message.time_updated,
                    data: sql`${message.data}`,
                  })
                  .run(),
              )
              yield* tx
                .insert(EventSequenceTable)
                .values({ aggregate_id: session.id, seq: history.at(-1)?.seq ?? -1 })
                .onConflictDoUpdate({
                  target: EventSequenceTable.aggregate_id,
                  set: { seq: history.at(-1)?.seq ?? -1, owner_id: null },
                })
                .run()
              return true
            }),
          )
          .pipe(Effect.orDie)
        onProgress(index + 1, imported)
        yield* Effect.yieldNow
      }
      if (kind === "redcode") yield* importRedcodeData(db, source)
      source.run("COMMIT")
    }),
  )
}

function importRedcodeData(db: Database.Interface["db"], source: SQLiteDatabase) {
  const tables = new Set(
    source
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  )
  return Effect.forEach(
    REDCODE_TABLES,
    (table) => {
      if (!tables.has(table.name)) return Effect.void
      const target = "target" in table ? table.target : table.name
      const columns = new Set(
        source
          .query<{ name: string }, [string]>("SELECT name FROM pragma_table_info(?)")
          .all(table.name)
          .map((column) => column.name),
      )
      const fallback = REDCODE_FALLBACKS[table.name] ?? {}
      const missing = table.columns.filter((column) => !columns.has(column) && fallback[column] === undefined)
      if (missing.length)
        return Effect.die(new Error(`Incompatible Redcode ${table.name} table: missing ${missing.join(", ")}`))
      const projection = table.columns.map((column) => {
        if (table.name === "session_context_epoch" && column === "replacement_seq") {
          const requested = columns.has(column) ? `"${column}"` : "NULL"
          const compacted = `(SELECT MAX(seq) FROM "session_message" WHERE session_id = "session_context_epoch"."session_id" AND type = 'compaction' AND seq > "session_context_epoch"."baseline_seq")`
          // V1 uses the latest replacement or compaction boundary after its baseline. Compare
          // source sequences before V1 and V2 histories are interleaved and renumbered during import.
          return `COALESCE(MAX(${requested}, ${compacted}), ${requested}, ${compacted}) AS "replacement_seq"`
        }
        if (columns.has(column)) return `"${column}"`
        return `${fallback[column]} AS "${column}"`
      })
      const rows = source.query<SourceRow, []>(`SELECT ${projection.join(", ")} FROM "${table.name}"`).all()
      return db
        .transaction((tx) =>
          Effect.forEach(
            rows,
            (row) =>
              Effect.gen(function* () {
                const where = sql.join(
                  table.key.map((column) => sql`${sql.identifier(column)} = ${row[column]}`),
                  sql` AND `,
                )
                const existing = yield* tx.get<SourceRow>(sql`SELECT * FROM ${sql.identifier(target)} WHERE ${where}`)
                if (existing) {
                  const changed = table.columns.find((column) => existing[column] !== row[column])
                  if (changed)
                    return yield* Effect.die(
                      new Error(
                        `Conflicting Redcode ${table.name} row at ${table.key.map((key) => row[key]).join(":")}`,
                      ),
                    )
                }
                if (!existing) yield* tx.run(sql`
            INSERT INTO ${sql.identifier(target)}
              (${sql.join(
                table.columns.map((column) => sql.identifier(column)),
                sql`, `,
              )})
            VALUES (${sql.join(
              table.columns.map((column) => sql`${row[column]}`),
              sql`, `,
            )})
          `)
                if (table.name !== "project_directory") return
                yield* tx.run(sql`
                  INSERT OR IGNORE INTO worktree (project_id, directory, strategy, time_created)
                  VALUES (
                    ${row.project_id}, ${row.directory},
                    ${row.strategy === "git_worktree" || (row.strategy === null && row.type === "git_worktree") ? "git" : row.strategy},
                    ${row.time_created}
                  )
                `)
              }),
            { discard: true },
          ),
        )
        .pipe(Effect.andThen(Effect.logInfo("Imported Redcode data", { table: table.name, rows: rows.length })))
    },
    { discard: true },
  ).pipe(
    Effect.andThen(
      db.run(sql`
        UPDATE session_v2
        SET share_url = (SELECT url FROM session_share WHERE session_share.session_id = session_v2.id)
        WHERE share_url IS NULL AND EXISTS (
          SELECT 1 FROM session_share WHERE session_share.session_id = session_v2.id
        )
      `),
    ),
  )
}

function hasLegacyMessages(source: SQLiteDatabase) {
  const tables = new Set(
    source
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('message', 'part')",
      )
      .all()
      .map((table) => table.name),
  )
  return tables.has("message") && tables.has("part")
}

function isNextDatabase(source: SQLiteDatabase) {
  const tables = new Set(
    source
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((table) => table.name),
  )
  return tables.has("project") && tables.has("session") && tables.has("session_message")
}

function selectNextRows<A>(source: SQLiteDatabase, table: "project" | "session", definition: NextColumns<A>) {
  const columns = new Set(
    source
      .query<{ name: string }, [string]>("SELECT name FROM pragma_table_info(?)")
      .all(table)
      .map((column) => column.name),
  )
  const missing = Object.entries(definition)
    .filter(([column, strategy]) => strategy === "required" && !columns.has(column))
    .map(([column]) => column)
  if (missing.length)
    throw new Error(`Incompatible opencode-next.db: ${table} is missing required columns: ${missing.join(", ")}`)
  const projection = Object.entries(definition).map(([column, strategy]) => {
    if (columns.has(column)) return `"${column}"`
    if (
      typeof strategy === "object" &&
      strategy !== null &&
      "fallback" in strategy &&
      typeof strategy.fallback === "string" &&
      columns.has(strategy.fallback)
    )
      return `"${strategy.fallback}" AS "${column}"`
    return `NULL AS "${column}"`
  })
  return source
    .query<A, []>(`SELECT ${projection.join(", ")} FROM "${table}"${table === "session" ? ' ORDER BY "id" DESC' : ""}`)
    .all()
}

function readState(db: Database.Interface["db"]): Effect.Effect<MigrationState | undefined> {
  return db
    .select({ value: KVTable.value })
    .from(KVTable)
    .where(eq(KVTable.key, MIGRATION_STATE_KEY))
    .get()
    .pipe(
      Effect.map((row) => parseState(row?.value)),
      Effect.orDie,
    )
}

function parseState(input: unknown): MigrationState | undefined {
  if (!input || typeof input !== "object" || !("phase" in input)) return
  if (input.phase === "completed") return { phase: "completed" }
  if (input.phase !== "sessions") return
  if (!("cursor" in input) || input.cursor === undefined) return { phase: "sessions" }
  if (typeof input.cursor === "string") return { phase: "sessions", cursor: input.cursor }
}

function hasLegacySessions(db: Database.Interface["db"]) {
  return db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'`).pipe(
    Effect.map((row) => row !== undefined),
    Effect.orDie,
  )
}
