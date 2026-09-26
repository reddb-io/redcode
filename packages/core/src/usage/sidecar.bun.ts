import { Database } from "bun:sqlite"
import { create, index, upsert, type Store } from "./sidecar.js"

export const supported = true

export function open(filename: string): Store {
  const db = new Database(filename, { create: true })
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec(create)
  db.exec(index)
  const statement = db.query(upsert)
  return {
    put(row) {
      statement.run(row.id, row.sessionID, row.timeCreated, row.timeUpdated, row.data)
    },
    close() {
      db.close()
    },
  }
}
