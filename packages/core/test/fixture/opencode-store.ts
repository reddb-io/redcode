export * as OpenCodeStore from "./opencode-store"

import { Database } from "bun:sqlite"
import { Session } from "@opencode/core/session"

// Rows shaped like an upstream OpenCode SQLite store, limited to the columns the importer reads.

export const user = (id: string, sessionID: string, time: number, extra: Record<string, unknown> = {}) => ({
  id,
  session_id: sessionID,
  time_created: time,
  time_updated: time + 1,
  data: JSON.stringify({
    role: "user",
    time: { created: time },
    agent: "build",
    model: { providerID: "provider", modelID: "model" },
    ...extra,
  }),
})

export const assistant = (
  id: string,
  sessionID: string,
  parentID: string,
  time: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  session_id: sessionID,
  time_created: time,
  time_updated: time + 5,
  data: JSON.stringify({
    role: "assistant",
    time: { created: time, completed: time + 5 },
    parentID,
    modelID: "model",
    providerID: "provider",
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost: 1,
    tokens: { total: 10, input: 2, output: 3, reasoning: 1, cache: { read: 4, write: 0 } },
    ...extra,
  }),
})

export const part = (id: string, messageID: string, sessionID: string, data: Record<string, unknown>) => ({
  id,
  message_id: messageID,
  session_id: sessionID,
  time_created: 1,
  time_updated: 2,
  data: JSON.stringify(data),
})

export const session = (
  id: string,
  input: { parent?: string; directory: string; title: string; created: number; updated: number },
) => ({
  id: Session.ID.make(id),
  parent_id: input.parent ?? null,
  directory: input.directory,
  title: input.title,
  version: "1.18.7",
  time_created: input.created,
  time_updated: input.updated,
  time_archived: null,
})

export function write(
  file: string,
  rows: {
    readonly sessions: ReadonlyArray<ReturnType<typeof session>>
    readonly messages: ReadonlyArray<ReturnType<typeof user>>
    readonly parts: ReadonlyArray<ReturnType<typeof part>>
  },
) {
  const db = new Database(file, { create: true })
  db.run(`CREATE TABLE session (
    id text PRIMARY KEY, project_id text, parent_id text, slug text, directory text NOT NULL, title text NOT NULL,
    version text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, time_archived integer
  )`)
  db.run(`CREATE TABLE message (
    id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL,
    data text NOT NULL
  )`)
  db.run(`CREATE TABLE part (
    id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL, time_created integer NOT NULL,
    time_updated integer NOT NULL, data text NOT NULL
  )`)
  rows.sessions.forEach((row) =>
    db
      .query(
        "INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated, time_archived) VALUES (?, 'global', ?, 'slug', ?, ?, ?, ?, ?, ?)",
      )
      .run(row.id, row.parent_id, row.directory, row.title, row.version, row.time_created, row.time_updated, null),
  )
  rows.messages.forEach((row) =>
    db
      .query("INSERT INTO message VALUES (?, ?, ?, ?, ?)")
      .run(row.id, row.session_id, row.time_created, row.time_updated, row.data),
  )
  rows.parts.forEach((row) =>
    db
      .query("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)")
      .run(row.id, row.message_id, row.session_id, row.time_created, row.time_updated, row.data),
  )
  db.close()
}
