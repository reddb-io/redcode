import { DatabaseSync } from "node:sqlite"
import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { create, index, upsert, type Store } from "./sidecar.js"

export const supported = true

export function resolve(home: string) {
  const preferred = path.join(home, ".red", "code", "data", "usage", "opencode.db")
  const legacy = path.join(home, ".red", "redcode", "data", "usage", "opencode.db")
  return existsSync(path.dirname(preferred)) || !existsSync(path.dirname(legacy)) ? preferred : legacy
}

export function open(filename: string): Store {
  mkdirSync(path.dirname(filename), { recursive: true })
  const db = new DatabaseSync(filename)
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec(create)
  db.exec(index)
  const statement = db.prepare(upsert)
  return {
    put(row) {
      statement.run(row.id, row.sessionID, row.timeCreated, row.timeUpdated, row.data)
    },
    close() {
      db.close()
    },
  }
}
