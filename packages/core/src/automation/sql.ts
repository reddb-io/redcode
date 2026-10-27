import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Automation } from "@opencode/schema/automation"
import type { ExecutionOwner } from "../execution-owner.js"
import { SessionTable } from "../session/sql.js"

export const AutomationTable = sqliteTable(
  "session_automation",
  {
    id: text().$type<Automation.ID>().primaryKey(),
    session_id: text()
      .$type<typeof SessionTable.$inferSelect.id>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    prompt: text().notNull(),
    schedule: text({ mode: "json" }).$type<Automation.Schedule>().notNull(),
    enabled: integer({ mode: "boolean" }).notNull(),
    next_at: integer(),
    created_at: integer().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [
    index("session_automation_due_idx").on(table.enabled, table.next_at),
    index("session_automation_session_idx").on(table.session_id),
  ],
)

export const AutomationRunTable = sqliteTable(
  "session_automation_run",
  {
    id: text().$type<Automation.RunID>().primaryKey(),
    automation_id: text()
      .$type<Automation.ID>()
      .notNull()
      .references(() => AutomationTable.id, { onDelete: "cascade" }),
    trigger: text().$type<Automation.Run["trigger"]>().notNull(),
    scheduled_at: integer().notNull(),
    status: text().$type<Automation.Run["status"]>().notNull(),
    owner: text({ mode: "json" }).$type<ExecutionOwner.Info>().notNull(),
    error: text(),
    created_at: integer().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [
    index("session_automation_run_status_idx").on(table.status),
    index("session_automation_run_history_idx").on(table.automation_id, table.created_at),
  ],
)
