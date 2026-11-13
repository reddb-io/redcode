import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Event } from "@opencode/schema/event"
import type { Location } from "@opencode/schema/location"

export type SubscriptionFilter = { readonly type: string; readonly field: string; readonly digest: string; readonly projection?: "basename" }
export type DeliveryFilter = { readonly type: string; readonly field: string; readonly value: string; readonly projection?: "basename" }

export const EventSequenceTable = sqliteTable("event_sequence", {
  aggregate_id: text().notNull().primaryKey(),
  seq: integer().notNull(),
  owner_id: text(),
})

export const EventTable = sqliteTable(
  "event",
  {
    id: text().$type<Event.ID>().primaryKey(),
    aggregate_id: text()
      .notNull()
      .references(() => EventSequenceTable.aggregate_id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    created: integer().notNull().default(0),
    type: text().notNull(),
    data: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    uniqueIndex("event_aggregate_seq_idx").on(table.aggregate_id, table.seq),
    index("event_aggregate_type_seq_idx").on(table.aggregate_id, table.type, table.seq),
    index("event_type_created_id_idx").on(table.type, table.created, table.id),
  ],
)

/** Stable subscriptions retain pending deliveries even while their consumer is offline. */
export const EventSubscriptionTable = sqliteTable("event_subscription", {
  id: text().notNull().primaryKey(),
  types: text({ mode: "json" }).$type<string[]>().notNull(),
  location: text({ mode: "json" }).$type<Location.Ref>(),
  filter: text({ mode: "json" }).$type<SubscriptionFilter>(),
})

export const EventJournalKeyTable = sqliteTable("event_journal_key", {
  id: integer().notNull().primaryKey(),
  digest: text().notNull(),
})

export const EventDeliveryTable = sqliteTable(
  "event_delivery",
  {
    seq: integer().primaryKey({ autoIncrement: true }),
    subscription_id: text().notNull().references(() => EventSubscriptionTable.id, { onDelete: "cascade" }),
    type: text().notNull(),
    payload: text().notNull(),
  },
  (table) => [index("event_delivery_subscription_seq_idx").on(table.subscription_id, table.seq)],
)
