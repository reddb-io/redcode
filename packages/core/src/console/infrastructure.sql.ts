import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { Infrastructure } from "@opencode/schema/infrastructure"
import { AccountTable, WorkspaceTable } from "./sql.js"

export const OwnerTable = sqliteTable("console_infrastructure_owner", {
  id: text().primaryKey(),
  name: text().notNull(),
  created_at: integer().notNull(),
})
export const OwnerMemberTable = sqliteTable(
  "console_infrastructure_member",
  {
    owner_id: text()
      .notNull()
      .references(() => OwnerTable.id, { onDelete: "cascade" }),
    account_id: text()
      .notNull()
      .references(() => AccountTable.id, { onDelete: "cascade" }),
    role: text().$type<Infrastructure.Role>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.owner_id, table.account_id] })],
)
export const ResourceTable = sqliteTable("console_infrastructure_resource", {
  id: text().primaryKey(),
  owner_id: text()
    .notNull()
    .references(() => OwnerTable.id, { onDelete: "cascade" }),
  name: text().notNull(),
  url: text(),
})
export const GrantTable = sqliteTable(
  "console_infrastructure_grant",
  {
    id: text().primaryKey(),
    resource_id: text()
      .notNull()
      .references(() => ResourceTable.id, { onDelete: "cascade" }),
    workspace_id: text()
      .notNull()
      .references(() => WorkspaceTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
  },
  (table) => [uniqueIndex("console_infrastructure_directory").on(table.resource_id, table.directory)],
)
export const InfrastructureAuditTable = sqliteTable("console_infrastructure_audit", {
  id: text().primaryKey(),
  owner_id: text()
    .notNull()
    .references(() => OwnerTable.id, { onDelete: "cascade" }),
  actor_id: text().notNull(),
  action: text().notNull(),
  resource_id: text().notNull(),
  created_at: integer().notNull(),
})
