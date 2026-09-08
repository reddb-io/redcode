/**
 * The shape both platform drivers implement. Two targets share it: our own sidecar, and the fan-out into
 * OpenCode's database, which needs the session and project rows its foreign keys demand.
 */
export interface SidecarStore {
  message(row: MessageRow): void
  session(row: SessionRow): void
  project(row: ProjectRow): void
  close(): void
}

/** One usage row, in the column layout ccusage's OpenCode reader expects. */
export interface MessageRow {
  readonly id: string
  readonly sessionID: string
  readonly timeCreated: number
  readonly timeUpdated: number
  readonly data: string
}

/** The session a usage row hangs off. OpenCode's `message.session_id` is a foreign key into this table. */
export interface SessionRow {
  readonly id: string
  readonly projectID: string
  readonly slug: string
  readonly directory: string
  readonly title: string
  readonly version: string
  readonly timeCreated: number
  readonly timeUpdated: number
}

/** The project a session hangs off — the other end of OpenCode's foreign-key chain. */
export interface ProjectRow {
  readonly id: string
  readonly worktree: string
  readonly timeCreated: number
  readonly timeUpdated: number
}

/**
 * Our own sidecar carries the message table alone: nothing reads it through a foreign key, and a usage reporter
 * only needs these four columns.
 */
export const CREATE_MESSAGE_TABLE = `CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  data TEXT NOT NULL
)`

export const CREATE_MESSAGE_INDEX = `CREATE INDEX IF NOT EXISTS message_time_created ON message (time_created)`

export const UPSERT_MESSAGE = `INSERT INTO message (id, session_id, time_created, time_updated, data)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data, time_updated = excluded.time_updated`

/**
 * The session and project rows exist for the fan-out target only, so they are written with the columns OpenCode's
 * schema makes NOT NULL and nothing else — every other column there either allows null or carries a default.
 * `INSERT OR IGNORE`: the row is written once and never overwrites what the other application owns.
 */
export const INSERT_SESSION = `INSERT OR IGNORE INTO session
  (id, project_id, slug, directory, title, version, time_created, time_updated)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`

export const INSERT_PROJECT = `INSERT OR IGNORE INTO project
  (id, worktree, time_created, time_updated, sandboxes)
  VALUES (?, ?, ?, ?, '[]')`
