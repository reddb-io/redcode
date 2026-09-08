import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core"
import type { SessionGoal } from "@reddb-io/redcode-schema/session-goal"
import type { SessionPlan } from "@reddb-io/redcode-schema/session-plan"
import { SessionTable } from "./sql"

export const SessionGoalTable = sqliteTable("session_goal", {
  session_id: text()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  goal_id: text().notNull(),
  revision: integer().notNull(),
  owner: text().notNull(),
  data: text({ mode: "json" }).$type<SessionGoal.Info>().notNull(),
})

// Usage outlives a discarded verdict or replacement of the current Goal.
export const SessionGoalReviewTable = sqliteTable(
  "session_goal_review",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    goal_id: text().notNull(),
    tokens: integer().notNull(),
    created: integer().notNull(),
  },
  (table) => [index("session_goal_review_session_goal_idx").on(table.session_id, table.goal_id)],
)

export const SessionPlanTable = sqliteTable(
  "session_plan",
  {
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    revision: text().notNull(),
    created: integer().notNull(),
    data: text({ mode: "json" }).$type<SessionPlan.Info>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.session_id, table.revision] })],
)
