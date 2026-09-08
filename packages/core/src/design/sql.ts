import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Design } from "@reddb-io/redcode-schema/design"

export const DesignTable = sqliteTable(
  "design_document",
  {
    id: text().primaryKey(),
    session_id: text().notNull(),
    directory: text().notNull(),
    data: text({ mode: "json" }).$type<Design.Info>().notNull(),
  },
  (table) => [index("design_document_session_idx").on(table.session_id)],
)

export const RevisionTable = sqliteTable(
  "design_revision",
  {
    id: text().primaryKey(),
    design_id: text()
      .notNull()
      .references(() => DesignTable.id, { onDelete: "cascade" }),
    created: integer().notNull(),
    data: text({ mode: "json" }).$type<Design.Revision>().notNull(),
  },
  (table) => [index("design_revision_document_idx").on(table.design_id)],
)

export const FeedbackTable = sqliteTable("design_feedback", {
  id: text().primaryKey(),
  design_id: text()
    .notNull()
    .references(() => DesignTable.id, { onDelete: "cascade" }),
  data: text({ mode: "json" }).$type<Design.Feedback>().notNull(),
  admitted: integer({ mode: "boolean" }).notNull().default(false),
})

export const AssetTable = sqliteTable("design_asset", {
  id: text().primaryKey(),
  design_id: text()
    .notNull()
    .references(() => DesignTable.id, { onDelete: "cascade" }),
  data: text({ mode: "json" }).$type<Design.Asset>().notNull(),
})

export const JobTable = sqliteTable("design_render_job", {
  id: text().primaryKey(),
  design_id: text()
    .notNull()
    .references(() => DesignTable.id, { onDelete: "cascade" }),
  data: text({ mode: "json" }).$type<Design.Job>().notNull(),
})
