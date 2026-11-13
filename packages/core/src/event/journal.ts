export * as EventJournal from "./journal.js"

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto"
import { deserialize } from "node:v8"
import { and, asc, eq, gt, inArray } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Event } from "@opencode/schema/event"
import type { Location } from "@opencode/schema/location"
import { isDeepStrictEqual } from "node:util"
import path from "node:path"
import type { Database } from "../database/database.js"
import { EventBuffer } from "./buffer.js"
import { EventDeliveryTable, EventJournalKeyTable, EventSubscriptionTable } from "./sql.js"
import type { DeliveryFilter } from "./sql.js"

/** A caller supplies a durable, protected key; losing it makes pending deliveries unreadable. */
export function make(db: Database.Interface["db"], key: Uint8Array) {
  if (key.byteLength !== 32) throw new Error("Event journal encryption key must be 32 bytes")
  const encryptionKey = Buffer.from(key)
  const digest = createHash("sha256").update(encryptionKey).digest("hex")

  const verifyKey = Effect.gen(function* () {
    const stored = yield* db.select().from(EventJournalKeyTable).where(eq(EventJournalKeyTable.id, 1)).get().pipe(Effect.orDie)
    if (!stored || stored.digest !== digest) throw new Error("The event journal key is missing or does not match this database")
  })

  const filterDigest = (value: string) => createHmac("sha256", encryptionKey).update(value).digest("hex")

  const register = (id: string, definitions: readonly Event.Definition[], location?: Location.Ref, filter?: DeliveryFilter) =>
    db.transaction(() => Effect.gen(function* () {
      if (!id || definitions.length === 0) throw new Error("A durable subscription needs an ID and event types")
      const types = Array.from(new Set(definitions.map((definition) => definition.type))).sort()
      if (filter && (!types.includes(filter.type) || !filter.field || typeof filter.value !== "string" || (filter.projection !== undefined && filter.projection !== "basename")))
        throw new Error("Invalid durable subscription filter")
      const storedFilter = filter ? { type: filter.type, field: filter.field, digest: filterDigest(filter.value), ...(filter.projection ? { projection: filter.projection } : {}) } : undefined
      yield* db.insert(EventJournalKeyTable).values({ id: 1, digest }).onConflictDoNothing().run().pipe(Effect.orDie)
      yield* verifyKey
      yield* db.insert(EventSubscriptionTable).values({ id, types, location, filter: storedFilter }).onConflictDoNothing().run().pipe(Effect.orDie)
      const stored = yield* db.select().from(EventSubscriptionTable).where(eq(EventSubscriptionTable.id, id)).get().pipe(Effect.orDie)
      if (JSON.stringify(stored?.types) !== JSON.stringify(types))
        throw new Error(`Durable subscription ${id} was registered with different event types`)
      if (!isDeepStrictEqual(stored?.location ?? undefined, location))
        throw new Error(`Durable subscription ${id} was registered for a different location`)
      if (!isDeepStrictEqual(stored?.filter ?? undefined, storedFilter))
        throw new Error(`Durable subscription ${id} was registered with a different filter`)
    })).pipe(Effect.orDie)

  // The publisher must call this inside the same transaction as its state changes.
  const enqueue = (event: Event.Payload, definition: Event.Definition, routes?: readonly Location.Ref[]) =>
    Effect.gen(function* () {
      const subscriptions = yield* db.select().from(EventSubscriptionTable).all().pipe(Effect.orDie)
      const candidates = subscriptions.filter((subscription) => subscription.types.includes(event.type))
      if (!candidates.length) return
      yield* verifyKey
      const matching = candidates.filter((subscription) => {
        const filter = subscription.filter
        if (filter && filter.type === event.type) {
          if (typeof event.data !== "object" || event.data === null || !Object.hasOwn(event.data, filter.field)) return false
          const value = (event.data as Record<string, unknown>)[filter.field]
          if (typeof value !== "string" || (filter.projection !== undefined && filter.projection !== "basename")) return false
          if (filterDigest(filter.projection === "basename" ? path.basename(value) : value) !== filter.digest) return false
        }
        if (!subscription.location) return true
        const refs = routes ?? (event.location ? [event.location] : undefined)
        if (!refs) return true
        return refs.some((ref) => ref.directory === subscription.location?.directory && ref.workspaceID === subscription.location.workspaceID)
      })
      if (!matching.length) return
      const bytes = EventBuffer.encode(event, definition)
      for (const subscription of matching) {
        const iv = randomBytes(12)
        const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv)
        cipher.setAAD(Buffer.from(JSON.stringify([subscription.id, event.type])))
        const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()])
        yield* db.insert(EventDeliveryTable).values({
          subscription_id: subscription.id,
          type: event.type,
          payload: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64"),
        }).run().pipe(Effect.orDie)
      }
    })

  const read = (id: string, definitions: readonly Event.Definition[], after?: number) =>
    Effect.gen(function* () {
      const where = after === undefined
        ? eq(EventDeliveryTable.subscription_id, id)
        : and(eq(EventDeliveryTable.subscription_id, id), gt(EventDeliveryTable.seq, after))
      const row = yield* db.select().from(EventDeliveryTable).where(where)
        .orderBy(asc(EventDeliveryTable.seq)).limit(1).get().pipe(Effect.orDie)
      if (!row) return undefined
      yield* verifyKey
      const definition = definitions.find((item) => item.type === row.type)
      if (!definition) throw new Error(`Unknown event type ${row.type} for durable subscription ${id}`)
      const bytes = Buffer.from(row.payload, "base64")
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey, bytes.subarray(0, 12))
      decipher.setAAD(Buffer.from(JSON.stringify([id, row.type])))
      decipher.setAuthTag(bytes.subarray(12, 28))
      const stored = deserialize(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()])) as Event.Payload
      const event = { ...stored, data: Schema.decodeUnknownSync(definition.data)(stored.data) } as Event.Payload
      return { seq: row.seq, size: bytes.byteLength, event }
    })

  const next = (id: string, definitions: readonly Event.Definition[]) =>
    Effect.gen(function* () {
      const row = yield* read(id, definitions)
      if (!row) return undefined
      const ack = db.delete(EventDeliveryTable)
        .where(and(eq(EventDeliveryTable.seq, row.seq), eq(EventDeliveryTable.subscription_id, id)))
        .run().pipe(Effect.orDie, Effect.asVoid)
      return { event: row.event, ack }
    })

  const nextBatch = (id: string, definitions: readonly Event.Definition[]) =>
    Effect.gen(function* () {
      const rows: { seq: number; event: Event.Payload }[] = []
      let size = 0
      while (rows.length < 32) {
        const row = yield* read(id, definitions, rows.at(-1)?.seq)
        if (!row || (rows.length && size + row.size > 1024 * 1024)) break
        rows.push(row)
        size += row.size
      }
      if (!rows.length) return undefined
      const ack = db.delete(EventDeliveryTable)
        .where(and(eq(EventDeliveryTable.subscription_id, id), inArray(EventDeliveryTable.seq, rows.map((row) => row.seq))))
        .run().pipe(Effect.orDie, Effect.asVoid)
      return { events: rows.map((row) => row.event), ack }
    })

  return { register, enqueue, next, nextBatch }
}
