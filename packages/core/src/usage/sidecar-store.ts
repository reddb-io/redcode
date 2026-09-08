/**
 * The shape both platform drivers implement. The sidecar is a tiny append-mostly table, so the driver surface is
 * two calls: upsert one row, close the handle.
 */
export interface SidecarStore {
  upsert(row: SidecarRow): void
  close(): void
}

/** One usage row, in the column layout ccusage's OpenCode reader expects. */
export interface SidecarRow {
  readonly id: string
  readonly sessionID: string
  readonly timeCreated: number
  readonly data: string
}

export const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  data TEXT NOT NULL
)`

export const CREATE_INDEX = `CREATE INDEX IF NOT EXISTS message_time_created ON message (time_created)`

export const UPSERT = `INSERT INTO message (id, session_id, time_created, data)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data, time_created = excluded.time_created`
