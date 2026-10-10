import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { Console } from "@opencode/schema/console"

export const AccountTable = sqliteTable("console_account", {
  id: text().primaryKey(),
  email: text().notNull().unique(),
  name: text().notNull(),
  password_hash: text().notNull(),
  created_at: integer().notNull(),
})
export const SessionTable = sqliteTable("console_session", {
  token_hash: text().primaryKey(),
  account_id: text()
    .notNull()
    .references(() => AccountTable.id, { onDelete: "cascade" }),
  expires_at: integer().notNull(),
})
export const IdentityTable = sqliteTable(
  "console_identity",
  {
    issuer: text().notNull(),
    subject: text().notNull(),
    account_id: text()
      .notNull()
      .references(() => AccountTable.id, { onDelete: "cascade" }),
    created_at: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.issuer, table.subject] })],
)
export const FederationAttemptTable = sqliteTable("console_federation_attempt", {
  state_hash: text().primaryKey(),
  browser_hash: text().notNull(),
  provider_id: text().notNull(),
  issuer: text().notNull(),
  client_id: text().notNull(),
  scope_kind: text().$type<Console.AuthScope>(),
  scope_id: text(),
  verifier: text().notNull(),
  nonce: text().notNull(),
  invite_hash: text(),
  session_hash: text(),
  expires_at: integer().notNull(),
})
export const OrganizationTable = sqliteTable("console_organization", {
  id: text().primaryKey(),
  name: text().notNull(),
  created_at: integer().notNull(),
})
export const MemberTable = sqliteTable(
  "console_member",
  {
    organization_id: text()
      .notNull()
      .references(() => OrganizationTable.id, { onDelete: "cascade" }),
    account_id: text()
      .notNull()
      .references(() => AccountTable.id, { onDelete: "cascade" }),
    role: text().$type<Console.Role>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.organization_id, table.account_id] })],
)
export const WorkspaceTable = sqliteTable("console_workspace", {
  id: text().primaryKey(),
  organization_id: text()
    .notNull()
    .references(() => OrganizationTable.id, { onDelete: "cascade" }),
  name: text().notNull(),
  created_at: integer().notNull(),
})
export const InviteTable = sqliteTable(
  "console_invite",
  {
    id: text().primaryKey(),
    organization_id: text()
      .notNull()
      .references(() => OrganizationTable.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: text().$type<"admin" | "member">().notNull(),
    token_hash: text().notNull().unique(),
    expires_at: integer().notNull(),
  },
  (table) => [uniqueIndex("console_invite_email").on(table.organization_id, table.email)],
)
export const KeyTable = sqliteTable("console_key", {
  id: text().primaryKey(),
  workspace_id: text()
    .notNull()
    .references(() => WorkspaceTable.id, { onDelete: "cascade" }),
  account_id: text()
    .notNull()
    .references(() => AccountTable.id, { onDelete: "cascade" }),
  name: text().notNull(),
  prefix: text().notNull(),
  token_hash: text().notNull().unique(),
  created_at: integer().notNull(),
  expires_at: integer(),
})
export const AuditTable = sqliteTable("console_audit", {
  id: text().primaryKey(),
  organization_id: text()
    .notNull()
    .references(() => OrganizationTable.id, { onDelete: "cascade" }),
  actor_id: text().notNull(),
  action: text().notNull(),
  resource_id: text().notNull(),
  created_at: integer().notNull(),
})
