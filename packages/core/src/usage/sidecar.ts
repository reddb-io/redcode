export interface Row {
  readonly id: string
  readonly sessionID: string
  readonly timeCreated: number
  readonly timeUpdated: number
  readonly data: string
}

export interface Store {
  put(row: Row): void
  close(): void
}

export const create = `CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  data TEXT NOT NULL
)`
export const index = `CREATE INDEX IF NOT EXISTS message_time_created ON message (time_created)`
export const upsert = `INSERT INTO message (id, session_id, time_created, time_updated, data)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data, time_updated = excluded.time_updated`
