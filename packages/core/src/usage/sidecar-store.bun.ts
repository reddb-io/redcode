import { Database } from "bun:sqlite"
import {
  CREATE_MESSAGE_INDEX,
  CREATE_MESSAGE_TABLE,
  INSERT_PROJECT,
  INSERT_SESSION,
  UPSERT_MESSAGE,
  type MessageRow,
  type ProjectRow,
  type SessionRow,
  type SidecarStore,
} from "./sidecar-store"

/**
 * `own` creates the message table; the fan-out target must never do that — the tables there belong to the other
 * application, and creating them would mean inventing a schema it did not choose.
 */
export function open(filename: string, options: { own: boolean }): SidecarStore {
  // `{ create }` alone is not a valid open mode in bun: the fan-out opens an existing file read-write, and only
  // our own sidecar may bring a file into existence.
  const database = options.own ? new Database(filename, { create: true }) : new Database(filename, { readwrite: true })
  database.exec("PRAGMA busy_timeout = 5000")
  if (options.own) {
    database.exec("PRAGMA journal_mode = WAL")
    database.exec("PRAGMA synchronous = NORMAL")
    database.exec(CREATE_MESSAGE_TABLE)
    database.exec(CREATE_MESSAGE_INDEX)
  }
  const message = database.query(UPSERT_MESSAGE)
  const session = options.own ? undefined : database.query(INSERT_SESSION)
  const project = options.own ? undefined : database.query(INSERT_PROJECT)
  return {
    message(row: MessageRow) {
      message.run(row.id, row.sessionID, row.timeCreated, row.timeUpdated, row.data)
    },
    session(row: SessionRow) {
      session?.run(row.id, row.projectID, row.slug, row.directory, row.title, row.version, row.timeCreated, row.timeUpdated)
    },
    project(row: ProjectRow) {
      project?.run(row.id, row.worktree, row.timeCreated, row.timeUpdated)
    },
    close() {
      database.close()
    },
  }
}
