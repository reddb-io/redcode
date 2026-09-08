import { DatabaseSync } from "node:sqlite"
import { CREATE_INDEX, CREATE_TABLE, UPSERT, type SidecarRow, type SidecarStore } from "./sidecar-store"

export function open(filename: string): SidecarStore {
  const database = new DatabaseSync(filename)
  database.exec("PRAGMA journal_mode = WAL")
  database.exec("PRAGMA synchronous = NORMAL")
  database.exec("PRAGMA busy_timeout = 5000")
  database.exec(CREATE_TABLE)
  database.exec(CREATE_INDEX)
  const statement = database.prepare(UPSERT)
  return {
    upsert(row: SidecarRow) {
      statement.run(row.id, row.sessionID, row.timeCreated, row.data)
    },
    close() {
      database.close()
    },
  }
}
