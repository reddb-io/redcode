import { sqliteTable, text, index } from "drizzle-orm/sqlite-core"
import type { Monitor } from "@reddb-io/redcode-schema/monitor"
import { SessionTable } from "./session/sql"

export const MonitorTable = sqliteTable(
  "session_monitor",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    owner: text().notNull(),
    data: text({ mode: "json" }).$type<Monitor.Info>().notNull(),
  },
  (table) => [index("session_monitor_session_idx").on(table.session_id)],
)
