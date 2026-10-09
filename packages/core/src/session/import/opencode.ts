export * as OpenCodeImport from "./opencode.js"

import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { SessionImport } from "@opencode/schema/session-import"
import { SessionMessage } from "@opencode/schema/session-message"
import { SessionTransfer } from "@opencode/schema/session-transfer"
import { sameDirectory } from "@opencode/util/path"
import type { Database as SQLiteDatabase } from "bun:sqlite"
import { Effect, Option, Schema } from "effect"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { V1Transform } from "../../database/v1-transform.js"
import { ImportSource } from "./source.js"

const SessionRow = Schema.Struct({
  id: Session.ID,
  parent_id: Schema.NullOr(Schema.String),
  directory: Schema.String,
  title: Schema.String,
  version: Schema.String,
  time_created: Schema.Finite,
  time_updated: Schema.Finite,
  time_archived: Schema.NullOr(Schema.Finite),
})
export type SessionRow = typeof SessionRow.Type

const MessageRow = Schema.Struct({
  id: Schema.String,
  session_id: Schema.String,
  time_created: Schema.Finite,
  time_updated: Schema.Finite,
  data: Schema.String,
})

const PartRow = Schema.Struct({
  id: Schema.String,
  message_id: Schema.String,
  session_id: Schema.String,
  time_created: Schema.Finite,
  time_updated: Schema.Finite,
  data: Schema.String,
})

const Count = Schema.Struct({ value: Schema.Finite })
const LastModel = Schema.Struct({ provider: Schema.NullOr(Schema.String), model: Schema.NullOr(Schema.String) })
const FirstText = Schema.Struct({ value: Schema.NullOr(Schema.String) })

export type Rows = {
  readonly sessions: ReadonlyArray<SessionRow>
  readonly messages: ReadonlyArray<V1Transform.SourceMessage>
  readonly parts: ReadonlyArray<V1Transform.SourcePart>
}

export type Normalized = {
  readonly sessions: ReadonlyArray<{
    readonly ref: string
    readonly version: string
    readonly data: SessionTransfer.Data
    readonly warnings: ReadonlyArray<string>
  }>
  readonly warnings: ReadonlyArray<string>
}

const decodeInfo = Schema.decodeUnknownOption(Session.Info)
const decodeMessage = Schema.decodeUnknownOption(SessionMessage.Info)
const SESSION_COLUMNS = "id, parent_id, directory, title, version, time_created, time_updated, time_archived"
// OpenCode names a session this way until it generates a title from the first prompt.
const PLACEHOLDER_TITLE = /^(New|Child) session - \d{4}-\d{2}-\d{2}T/

/**
 * Normalize OpenCode V1 session, message, and part rows into transfer data, parents before
 * children. A session whose parent is not among the rows becomes a root.
 */
export function normalize(rows: Rows): Normalized {
  const messages = Map.groupBy(rows.messages, (row) => row.session_id)
  const parts = Map.groupBy(rows.parts, (row) => row.session_id)
  const accepted = new Set<string>()
  const sessions = parentsFirst(rows.sessions).flatMap((session) => {
    const transformed = V1Transform.transformSession({
      session: { id: session.id, agent: null, model: null },
      messages: messages.get(session.id) ?? [],
      parts: parts.get(session.id) ?? [],
    })
    const warnings = transformed.warnings.map(
      (warning) =>
        `Skipped ${warning.reason.replace("-", " ")} ${warning.partID ?? warning.messageID ?? ""}`.trimEnd() +
        ` in ${warning.sessionID}`,
    )
    const converted = transformed.messages.flatMap((message) => {
      // Snapshot hashes name OpenCode's private snapshot store and cannot be restored here.
      const { snapshot: _, ...data } = message.data
      const decoded = decodeMessage({ ...data, id: message.id, type: message.type })
      if (Option.isSome(decoded)) return [decoded.value]
      warnings.push(`Skipped unreadable ${message.type} message ${message.id} in ${session.id}`)
      return []
    })
    const info = decodeInfo({
      id: session.id,
      ...(session.parent_id && accepted.has(session.parent_id) ? { parentID: session.parent_id } : {}),
      projectID: Project.ID.global,
      ...(transformed.session.agent ? { agent: transformed.session.agent } : {}),
      ...(transformed.session.model ? { model: transformed.session.model } : {}),
      cost: transformed.session.cost,
      tokens: {
        input: transformed.session.tokens_input,
        output: transformed.session.tokens_output,
        reasoning: transformed.session.tokens_reasoning,
        cache: { read: transformed.session.tokens_cache_read, write: transformed.session.tokens_cache_write },
      },
      time: {
        created: session.time_created,
        updated: session.time_updated,
        ...(session.time_archived === null ? {} : { archived: session.time_archived }),
      },
      title: session.title,
      location: { directory: ImportSource.directory(session.directory) },
    })
    if (Option.isNone(info)) return []
    accepted.add(session.id)
    return [{ ref: session.id, version: session.version, data: { info: info.value, messages: converted }, warnings }]
  })
  const skipped = rows.sessions
    .filter((session) => !accepted.has(session.id))
    .map((session) => `Skipped unreadable session ${session.id}`)
  return { sessions, warnings: [...skipped, ...sessions.flatMap((session) => session.warnings)] }
}

/** Depth-first so every parent precedes its children; rows unreachable from a root (cycles) are dropped. */
function parentsFirst(sessions: ReadonlyArray<SessionRow>) {
  const ids = new Set<string>(sessions.map((session) => session.id))
  const children = Map.groupBy(sessions, (session): string =>
    session.parent_id && ids.has(session.parent_id) ? session.parent_id : "",
  )
  const visit = (parent: string): ReadonlyArray<SessionRow> =>
    (children.get(parent) ?? [])
      .toSorted((a, b) => a.time_created - b.time_created || a.id.localeCompare(b.id))
      .flatMap((session) => [session, ...visit(session.id)])
  return visit("")
}

/** OpenCode keeps its data under the XDG data directory, which defaults to `~/.local/share` on every platform. */
export function directories() {
  return Array.from(
    new Set(
      [
        process.env.XDG_DATA_HOME,
        path.join(os.homedir(), ".local", "share"),
        process.env.USERPROFILE && path.join(process.env.USERPROFILE, ".local", "share"),
      ]
        .filter((root): root is string => Boolean(root))
        .map((root) => path.join(root, "opencode")),
    ),
  )
}

export function adapter(input: { readonly directories: ReadonlyArray<string> }): ImportSource.Adapter {
  const locate = () => {
    const database = input.directories.map((root) => path.join(root, "opencode.db")).find((file) => existsSync(file))
    if (database) return { path: database }
    const storage = input.directories.map((root) => path.join(root, "storage")).find((dir) => existsSync(dir))
    if (storage)
      return {
        path: storage,
        warning: `Unsupported older OpenCode storage at ${storage}. Run a current OpenCode release once to migrate it to SQLite, then import again.`,
      }
    return { warning: "No OpenCode session store found" }
  }
  const store = Effect.fnUntraced(function* () {
    const located = locate()
    if (located.warning || !located.path)
      return yield* new ImportSource.UnavailableError({ source: "opencode", message: located.warning ?? "" })
    return located.path
  })
  return {
    source: "opencode",
    name: "OpenCode",
    detect: Effect.fnUntraced(function* () {
      const located = locate()
      const base = { source: "opencode" as const, name: "OpenCode", ...(located.path ? { path: located.path } : {}) }
      if (located.warning || !located.path) return { ...base, available: false, sessions: 0, warning: located.warning }
      return yield* read(located.path, (db) =>
        query(db, Count, "SELECT COUNT(*) AS value FROM session WHERE parent_id IS NULL"),
      ).pipe(
        Effect.match({
          onFailure: (error) => ({ ...base, available: false, sessions: 0, warning: error.message }),
          onSuccess: (rows) => ({ ...base, available: true, sessions: rows[0]?.value ?? 0 }),
        }),
      )
    }),
    list: Effect.fnUntraced(function* (options) {
      const file = yield* store()
      return yield* read(file, (db) =>
        Effect.gen(function* () {
          const roots = (yield* query(
            db,
            SessionRow,
            `SELECT ${SESSION_COLUMNS} FROM session WHERE parent_id IS NULL ORDER BY time_updated DESC, id DESC`,
          ))
            .filter(
              (row) => !options.directory || sameDirectory(ImportSource.directory(row.directory), options.directory),
            )
            .slice(0, options.limit)
          return yield* Effect.forEach(roots, (row) => summary(db, row))
        }),
      )
    }),
    load: Effect.fnUntraced(function* (ref) {
      const file = yield* store()
      const rows = yield* read(file, (db) =>
        Effect.gen(function* () {
          const tree = `WITH RECURSIVE tree(id) AS (
            SELECT id FROM session WHERE id = ?1
            UNION SELECT session.id FROM session JOIN tree ON session.parent_id = tree.id
          )`
          return {
            sessions: yield* query(
              db,
              SessionRow,
              `${tree} SELECT ${SESSION_COLUMNS} FROM session WHERE id IN (SELECT id FROM tree)`,
              ref,
            ),
            messages: yield* query(
              db,
              MessageRow,
              `${tree} SELECT id, session_id, time_created, time_updated, data FROM message WHERE session_id IN (SELECT id FROM tree)`,
              ref,
            ),
            parts: yield* query(
              db,
              PartRow,
              `${tree} SELECT id, message_id, session_id, time_created, time_updated, data FROM part WHERE session_id IN (SELECT id FROM tree)`,
              ref,
            ),
          }
        }),
      )
      if (rows.sessions.length === 0) return yield* new ImportSource.NotFoundError({ source: "opencode", ref })
      const normalized = normalize(rows)
      if (normalized.sessions[0]?.ref !== ref)
        return yield* new ImportSource.UnavailableError({
          source: "opencode",
          message: `OpenCode session ${ref} could not be read: ${normalized.warnings.join("; ")}`,
        })
      return { source: "opencode" as const, name: "OpenCode", path: file, sessions: normalized.sessions }
    }),
  }
}

function summary(db: SQLiteDatabase, row: SessionRow) {
  return Effect.gen(function* () {
    const messages = yield* query(db, Count, "SELECT COUNT(*) AS value FROM message WHERE session_id = ?1", row.id)
    const subagents = yield* query(db, Count, "SELECT COUNT(*) AS value FROM session WHERE parent_id = ?1", row.id)
    const model = yield* query(
      db,
      LastModel,
      `SELECT json_extract(data, '$.providerID') AS provider, json_extract(data, '$.modelID') AS model
       FROM message WHERE session_id = ?1 AND json_extract(data, '$.role') = 'assistant'
       ORDER BY time_created DESC, id DESC LIMIT 1`,
      row.id,
    )
    const title = row.title && !PLACEHOLDER_TITLE.test(row.title) ? row.title : yield* firstText(db, row)
    return {
      source: "opencode" as const,
      ref: row.id,
      title,
      directory: ImportSource.directory(row.directory),
      messages: messages[0]?.value ?? 0,
      subagents: subagents[0]?.value ?? 0,
      ...(model[0]?.provider && model[0].model ? { model: `${model[0].provider}/${model[0].model}` } : {}),
      time: { created: row.time_created, updated: row.time_updated },
    }
  }).pipe(
    Effect.flatMap((value) =>
      Schema.decodeUnknownEffect(SessionImport.Summary)(value).pipe(Effect.mapError(unreadable)),
    ),
  )
}

function firstText(db: SQLiteDatabase, row: SessionRow) {
  return query(
    db,
    FirstText,
    `SELECT json_extract(part.data, '$.text') AS value FROM part JOIN message ON message.id = part.message_id
     WHERE part.session_id = ?1 AND json_extract(message.data, '$.role') = 'user'
       AND json_extract(part.data, '$.type') = 'text' AND coalesce(json_extract(part.data, '$.synthetic'), 0) = 0
     ORDER BY message.time_created, part.id LIMIT 1`,
    row.id,
  ).pipe(
    Effect.map((rows) => {
      const text = rows[0]?.value?.replace(/\s+/g, " ").trim()
      if (!text) return row.title || row.id
      return text.length > 80 ? `${text.slice(0, 79)}…` : text
    }),
  )
}

/** Open the store read-only for the duration of `use`; the source database is never written. */
function read<A, E>(file: string, use: (db: SQLiteDatabase) => Effect.Effect<A, E>) {
  return Effect.acquireUseRelease(
    Effect.tryPromise({
      try: async () => {
        const { Database } = await import("bun:sqlite")
        return new Database(file, { readonly: true })
      },
      catch: unreadable,
    }),
    use,
    (db) => Effect.sync(() => db.close()),
  )
}

function query<S extends Schema.Codec<unknown, unknown, never, never>>(
  db: SQLiteDatabase,
  schema: S,
  sql: string,
  ...params: ReadonlyArray<string>
) {
  return Effect.try({ try: () => db.query(sql).all(...params), catch: unreadable }).pipe(
    Effect.flatMap((rows) => Schema.decodeUnknownEffect(Schema.Array(schema))(rows).pipe(Effect.mapError(unreadable))),
  )
}

function unreadable(cause: unknown) {
  return new ImportSource.UnavailableError({
    source: "opencode",
    message: `Failed to read the OpenCode session store: ${cause instanceof Error ? cause.message : String(cause)}`,
  })
}
