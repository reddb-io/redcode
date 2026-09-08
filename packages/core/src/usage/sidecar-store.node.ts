import { DatabaseSync } from "node:sqlite"
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

/** See the bun driver: `own` decides whether this process may create the schema. */
export function open(filename: string, options: { own: boolean }): SidecarStore {
  // Only our own sidecar may create a file; the fan-out opens what is already there.
  const database = new DatabaseSync(filename, { readOnly: false, ...(options.own ? {} : { open: true }) })
  database.exec("PRAGMA busy_timeout = 5000")
  if (options.own) {
    database.exec("PRAGMA journal_mode = WAL")
    database.exec("PRAGMA synchronous = NORMAL")
    database.exec(CREATE_MESSAGE_TABLE)
    database.exec(CREATE_MESSAGE_INDEX)
  }
  const message = database.prepare(UPSERT_MESSAGE)
  const session = options.own ? undefined : database.prepare(INSERT_SESSION)
  const project = options.own ? undefined : database.prepare(INSERT_PROJECT)
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
