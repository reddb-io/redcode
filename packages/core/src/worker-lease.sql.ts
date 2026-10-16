import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { ExecutionOwner } from "./execution-owner.js"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"

// Keep the generation tombstone after release. Deleting it would accept old fences again.
export const WorkerLeaseTable = sqliteTable("worker_lease", {
  directory: text().primaryKey(),
  generation: integer().notNull(),
  owner: text().notNull(),
  holder: text().notNull(),
  session_id: text().$type<Session.ID>().notNull(),
  message_id: text().$type<SessionMessage.ID>().notNull(),
  expires_at: integer().notNull(),
  released: integer({ mode: "boolean" }).notNull().default(false),
  operations: text({ mode: "json" }).$type<{ id: string; runtime: ExecutionOwner.Info }[]>().notNull(),
})

// Old Sessions remain fenced after the checkout is assigned to its next task.
export const WorkerAssignmentTable = sqliteTable("worker_assignment", {
  session_id: text().$type<Session.ID>().primaryKey(),
  directory: text().notNull(),
  generation: integer().notNull(),
})
