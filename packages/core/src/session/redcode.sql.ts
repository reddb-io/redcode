import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { SessionGoal } from "@opencode/schema/session-goal"
import type { SessionPlan } from "@opencode/schema/session-plan"
import type { SessionTodo } from "@opencode/schema/session-todo"
import { Timestamps } from "../database/schema.sql.js"
import { SessionTable } from "./sql.js"

export const SessionGoalTable = sqliteTable("session_goal", {
  session_id: text()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  goal_id: text().notNull(),
  revision: integer().notNull(),
  owner: text().notNull(),
  data: text({ mode: "json" }).$type<SessionGoal.Info>().notNull(),
})

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

export const TodoTable = sqliteTable(
  "todo",
  {
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: integer().notNull(),
    task_id: text(),
    revision: integer().notNull().default(1),
    reason: text(),
    legacy_status: text(),
    details: text({ mode: "json" }).$type<
      Pick<SessionTodo.Info, "title" | "phase" | "source" | "criterion" | "evidence" | "scopeChange" | "closedAt">
    >(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.position] }),
    index("todo_session_idx").on(table.session_id),
  ],
)

export const TodoHistoryTable = sqliteTable(
  "todo_history",
  {
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    task_id: text().notNull(),
    revision: integer().notNull(),
    data: text({ mode: "json" }).$type<SessionTodo.Info>().notNull(),
    created: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.session_id, table.task_id, table.revision] })],
)

export const SessionGuardTripTable = sqliteTable(
  "session_guard_trip",
  {
    id: text().primaryKey(),
    session_id: text().notNull(),
    guard: text().notNull(),
    action: text().notNull(),
    subject: text(),
    detail: text().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("session_guard_trip_session_idx").on(table.session_id),
    index("session_guard_trip_created_idx").on(table.time_created),
  ],
)

export const SessionShareTable = sqliteTable("session_share", {
  session_id: text()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  id: text().notNull(),
  secret: text().notNull(),
  url: text().notNull(),
  resource: text({ enum: ["share", "shares"] })
    .notNull()
    .default("share"),
  credential_id: text(),
  account_id: text(),
  org_id: text(),
  ...Timestamps,
})
