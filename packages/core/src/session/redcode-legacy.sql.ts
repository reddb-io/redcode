import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./sql.js"

// V1 execution state is staged separately from V2's event-sourced inbox and instruction epoch.
export const RedcodeSessionInputTable = sqliteTable("redcode_session_input", {
  id: text().primaryKey(),
  session_id: text()
    .notNull()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  prompt: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
  delivery: text().notNull(),
  admitted_seq: integer().notNull(),
  promoted_seq: integer(),
  time_created: integer().notNull(),
})

export const RedcodeSessionContextEpochTable = sqliteTable("redcode_session_context_epoch", {
  session_id: text()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  baseline: text().notNull(),
  snapshot: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
  baseline_seq: integer().notNull(),
  replacement_seq: integer(),
})
