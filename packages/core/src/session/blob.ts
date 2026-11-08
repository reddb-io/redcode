export * as SessionBlob from "./blob.js"

import { createHash } from "node:crypto"
import { and, eq, exists, gte, inArray, notExists, type SQL } from "drizzle-orm"
import { Effect } from "effect"
import type { Database } from "../database/database.js"
import type { SessionMessage } from "./message.js"
import type { SessionSchema } from "./schema.js"
import { BlobRefTable, BlobTable, SessionMessageTable } from "./sql.js"

type DatabaseService = Database.Interface["db"]
type MessageRow = typeof SessionMessageTable.$inferSelect
type PublicFile = NonNullable<Extract<SessionMessage.Info, { type: "user" }>["files"]>[number]
type FileRef = Omit<PublicFile, "data"> & { readonly uri: `media:${string}` }
type StoredFile = PublicFile | FileRef
type StoredData = MessageRow["data"] & { readonly files?: ReadonlyArray<StoredFile> }

const PREFIX = "media:"
const HASH = /^[0-9a-f]{64}$/u

export const hashBytes = (raw: Uint8Array) => createHash("sha256").update(raw).digest("hex")

export const ref = (hash: string): `media:${string}` => `${PREFIX}${hash}`

export function refHash(uri: string) {
  const hash = uri.startsWith(PREFIX) ? uri.slice(PREFIX.length) : ""
  return HASH.test(hash) ? hash : undefined
}

function isRef(file: StoredFile): file is FileRef {
  return "uri" in file && refHash(file.uri) !== undefined
}

function hashesOf(data: StoredData) {
  const hashes = new Set<string>()
  for (const file of data.files ?? []) {
    if (!isRef(file)) continue
    const hash = refHash(file.uri)
    if (hash) hashes.add(hash)
  }
  return hashes
}

const view = (data: Uint8Array) =>
  Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength)

/** Moves inline user attachments into the content-addressed table before projection. */
export const externalize = Effect.fnUntraced(function* (db: DatabaseService, data: MessageRow["data"]) {
  if (!("files" in data) || !data.files?.length) return data
  const blobs = new Map<string, typeof BlobTable.$inferInsert>()
  const files = data.files.map((file): StoredFile => {
    const stored = file as StoredFile
    if (isRef(stored)) return stored
    const raw = Buffer.from(stored.data, "base64")
    const hash = hashBytes(raw)
    if (!blobs.has(hash)) blobs.set(hash, { hash, mime: stored.mime, bytes: raw.byteLength, data: raw })
    const { data: _, ...rest } = stored
    return { ...rest, uri: ref(hash) }
  })
  if (blobs.size === 0) return data
  yield* db.insert(BlobTable).values([...blobs.values()]).onConflictDoNothing().run().pipe(Effect.orDie)
  return { ...data, files } as MessageRow["data"]
})

function unavailable(file: FileRef): PublicFile {
  const { uri: _, ...rest } = file
  const label = file.name === undefined ? file.mime : `${file.name} (${file.mime})`
  return {
    ...rest,
    data: Buffer.from(`[media unavailable: ${label}]`).toString("base64"),
    mime: "text/plain",
  }
}

/** Hydrates stored refs before public schema decoding, preserving the existing wire contract. */
export const hydrateRow = Effect.fnUntraced(function* (db: DatabaseService, row: MessageRow) {
  const data = row.data as StoredData
  const hashes = hashesOf(data)
  if (hashes.size === 0) return row
  const found = yield* db
    .select({ hash: BlobTable.hash, data: BlobTable.data })
    .from(BlobTable)
    .where(inArray(BlobTable.hash, [...hashes]))
    .all()
    .pipe(Effect.orDie)
  const blobs = new Map(found.map((blob) => [blob.hash, view(blob.data).toString("base64")]))
  const files = (data.files ?? []).map((file): PublicFile => {
    if (!isRef(file)) return file
    const hash = refHash(file.uri)
    const bytes = hash ? blobs.get(hash) : undefined
    if (bytes === undefined) return unavailable(file)
    const { uri: _, ...rest } = file
    return { ...rest, data: bytes }
  })
  return { ...row, data: { ...data, files } as MessageRow["data"] }
})

/** Leaves valid refs in place for an opted-in client and annotates them with their byte size. */
export const keepRow = Effect.fnUntraced(function* (db: DatabaseService, row: MessageRow) {
  const data = row.data as StoredData
  const hashes = hashesOf(data)
  if (hashes.size === 0) return row
  const found = yield* db
    .select({ hash: BlobTable.hash, bytes: BlobTable.bytes })
    .from(BlobTable)
    .where(
      and(
        inArray(BlobTable.hash, [...hashes]),
        exists(db.select({ hash: BlobRefTable.hash }).from(BlobRefTable).where(eq(BlobRefTable.hash, BlobTable.hash))),
      ),
    )
    .all()
    .pipe(Effect.orDie)
  const meta = new Map(found.map((blob) => [blob.hash, blob.bytes]))
  const files = (data.files ?? []).map((file) => {
    if (!isRef(file)) return file
    const hash = refHash(file.uri)
    const bytes = hash ? meta.get(hash) : undefined
    return bytes === undefined ? unavailable(file) : { ...file, bytes }
  })
  return { ...row, data: { ...data, files } as MessageRow["data"] }
})

export interface Owner {
  readonly sessionID: SessionSchema.ID
  readonly messageID: SessionMessage.ID
  readonly seq: number
}

/** Makes the projected row the authority that keeps its blobs readable. */
export const syncRefs = Effect.fnUntraced(function* (db: DatabaseService, owner: Owner, data: MessageRow["data"]) {
  const hashes = hashesOf(data as StoredData)
  const own = [eq(BlobRefTable.session_id, owner.sessionID), eq(BlobRefTable.message_id, owner.messageID)] as const
  if (hashes.size > 0) {
    yield* db
      .insert(BlobRefTable)
      .values([...hashes].map((hash) => ({ session_id: owner.sessionID, message_id: owner.messageID, hash, seq: owner.seq })))
      .onConflictDoUpdate({
        target: [BlobRefTable.session_id, BlobRefTable.message_id, BlobRefTable.hash],
        set: { seq: owner.seq },
      })
      .run()
      .pipe(Effect.orDie)
  }
  const stale = yield* db
    .select({ hash: BlobRefTable.hash })
    .from(BlobRefTable)
    .where(and(...own))
    .all()
    .pipe(Effect.orDie)
  const removed = stale.flatMap(({ hash }) => (hashes.has(hash) ? [] : [hash]))
  if (removed.length > 0) yield* release(db, ...own, inArray(BlobRefTable.hash, removed))
})

const release = Effect.fnUntraced(function* (db: DatabaseService, ...where: readonly [SQL, ...SQL[]]) {
  const released = yield* db
    .delete(BlobRefTable)
    .where(and(...where))
    .returning({ hash: BlobRefTable.hash })
    .all()
    .pipe(Effect.orDie)
  const hashes = [...new Set(released.map(({ hash }) => hash))]
  if (hashes.length === 0) return
  yield* db
    .delete(BlobTable)
    .where(
      and(
        inArray(BlobTable.hash, hashes),
        notExists(db.select({ hash: BlobRefTable.hash }).from(BlobRefTable).where(eq(BlobRefTable.hash, BlobTable.hash))),
      ),
    )
    .run()
    .pipe(Effect.orDie)
})

export const releaseSession = (db: DatabaseService, sessionID: SessionSchema.ID) =>
  release(db, eq(BlobRefTable.session_id, sessionID))

export const releaseFrom = (db: DatabaseService, sessionID: SessionSchema.ID, seq: number) =>
  release(db, eq(BlobRefTable.session_id, sessionID), gte(BlobRefTable.seq, seq))

/** Reads only blobs still referenced by a projected message. */
export const read = Effect.fnUntraced(function* (db: DatabaseService, hash: string) {
  const blob = yield* db
    .select({ mime: BlobTable.mime, data: BlobTable.data })
    .from(BlobTable)
    .where(
      and(
        eq(BlobTable.hash, hash),
        exists(db.select({ hash: BlobRefTable.hash }).from(BlobRefTable).where(eq(BlobRefTable.hash, BlobTable.hash))),
      ),
    )
    .get()
    .pipe(Effect.orDie)
  return blob && { mime: blob.mime, data: view(blob.data) }
})
