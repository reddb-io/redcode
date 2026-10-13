import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { UsageReporter } from "@opencode/schema/usage-reporter"

export const UsageReporterConfigTable = sqliteTable("usage_reporter_config", {
  id: text().primaryKey(),
  instance_id: text().notNull(),
  enabled: integer({ mode: "boolean" }).notNull(),
  transport: text().$type<UsageReporter.Config["transport"]>().notNull(),
  url: text().notNull(),
  queue: text().notNull(),
  credential_id: text(),
  since: integer().notNull(),
})

export const UsageReporterRecordTable = sqliteTable(
  "usage_reporter_record",
  {
    id: text().primaryKey(),
    session_id: text().notNull(),
    created: integer().notNull(),
    data: text({ mode: "json" }).$type<UsageReporter.Record>().notNull(),
  },
  (table) => [index("usage_reporter_record_session_idx").on(table.session_id)],
)

export const UsageReporterDeliveryTable = sqliteTable(
  "usage_reporter_delivery",
  {
    id: text().primaryKey(),
    status: text().$type<UsageReporter.Delivery["status"]>().notNull(),
    attempts: integer().notNull().default(0),
    next_attempt_at: integer().notNull(),
    lease: text(),
    lease_until: integer(),
    http_status: integer(),
    error: text().$type<UsageReporter.Delivery["error"]>(),
    destination: text({ mode: "json" })
      .$type<{
        transport: UsageReporter.Config["transport"]
        url: string
        queue: string
        credential_id: string | null
      }>()
      .notNull(),
  },
  (table) => [index("usage_reporter_delivery_due_idx").on(table.status, table.next_attempt_at)],
)
