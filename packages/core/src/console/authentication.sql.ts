import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Console } from "@opencode/schema/console"
import type { Credential } from "@opencode/schema/credential"

export const AuthSettingTable = sqliteTable("console_auth_setting", {
  id: text().primaryKey(),
  public_url: text().notNull(),
})
export const AuthProviderTable = sqliteTable("console_auth_provider", {
  id: text().primaryKey(),
  scope_kind: text().$type<Console.AuthScope>().notNull(),
  scope_id: text().notNull(),
  name: text().notNull(),
  issuer: text().notNull(),
  client_id: text().notNull(),
  token_auth_method: text().$type<Console.AuthProviderInput["tokenAuthMethod"]>().notNull(),
  credential_id: text().$type<Credential.ID>(),
  enabled: integer({ mode: "boolean" }).notNull(),
})
