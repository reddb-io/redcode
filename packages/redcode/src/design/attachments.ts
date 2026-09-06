/**
 * Images a person attaches to a note, kept as files.
 *
 * Content-addressed storage under the data directory: one file per (prototype, sha256 of the
 * bytes), a tiny `.meta` sidecar with the dimensions beside it, both owner-only. The id
 * `<sha256>.<ext>` is the whole identity — the browser never chooses a path, and every field the
 * agent receives is re-derived from disk, so a crafted note cannot point at an arbitrary file.
 *
 * Bounded on every axis a hostile page could push on: bytes per image, images and bytes per note,
 * a time-to-live, a disk quota measured in allocated blocks (a flood of tiny files costs inodes,
 * not logical bytes), and a derived object count. The sweep reaps what is both expired and
 * unreferenced, then evicts the oldest unreferenced files past the quota — never a referenced one,
 * never one younger than the grace, because a fresh upload may be a note about to be sent.
 *
 * Ported from lavish-axi's attachment store (MIT).
 */

import { createHash } from "node:crypto"
import { chmod, mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises"
import path from "node:path"
import { Global } from "@reddb-io/redcode-core/global"

export const ROOT = path.join(Global.Path.data, "designs", "attachments")

const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/
const ID_RE = /^[0-9a-f]{64}\.(png|jpg|webp)$/
const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }

export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
export const DEFAULT_MAX_PER_PROMPT = 4
export const DEFAULT_MAX_PROMPT_BYTES = 25 * 1024 * 1024
export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const DEFAULT_MAX_DISK_BYTES = 512 * 1024 * 1024
/** A fresh, unreferenced file may be a note about to be sent: not evicted for this long. */
export const EVICTION_GRACE_MS = 60 * 60 * 1000
/** A delivered image stays referenced this long, so a turn still reading it is not cut off. */
export const DELIVERY_GRACE_MS = 60 * 60 * 1000
/** Refs one send may carry, before any file is looked at. */
export const MAX_REQUEST_REFS = 256
export const MAX_DELIVERED = 256
/** The unit the disk quota charges per object; every file costs at least one. */
export const ALLOC_BLOCK_BYTES = 4096
const FILE_MODE = 0o600
const DIR_MODE = 0o700
const TEMP_RE = /\.\d+\.\d+\.tmp$/
/** A temp older than this is crash debris, never a live write. */
const TEMP_GRACE_MS = 5 * 60 * 1000
const SIDECAR_ORPHAN_RE = /^([0-9a-f]{64}\.(?:png|jpg|webp))\.meta$/

export const ACCEPTED_MIME = ["image/png", "image/jpeg", "image/webp"] as const

export interface Config {
  readonly maxBytes: number
  readonly maxPerPrompt: number
  readonly maxPromptBytes: number
  readonly ttlMs: number | null
  readonly maxDiskBytes: number | null
  readonly maxObjects: number | null
  readonly evictionGraceMs: number
}

export interface Meta {
  readonly id: string
  readonly type: "image"
  readonly path: string
  readonly mime: string
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

export interface Ref {
  readonly id: string
  readonly name?: string
}

export type Rejection = {
  readonly id: string
  readonly name: string
  readonly reason: "malformed" | "too-many" | "too-many-in-request" | "not-found" | "prompt-bytes-exceeded"
}

export class StoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

let temporaryFileId = 0

/** The limits, from config; `0`/`false` disable a duration or the quota, anything odd falls back. */
export function resolveConfig(
  input: {
    readonly max_bytes?: number
    readonly max_per_prompt?: number
    readonly max_prompt_bytes?: number
    readonly ttl_ms?: number | false
    readonly max_disk_mb?: number | false
  } = {},
): Config {
  const positive = (value: unknown, fallback: number) => {
    const n = Math.floor(Number(value))
    return value !== undefined && Number.isFinite(n) && n >= 1 ? n : fallback
  }
  const duration = (value: unknown, fallback: number): number | null => {
    if (value === false || value === 0) return null
    const n = Number(value)
    return value !== undefined && Number.isFinite(n) && n > 0 ? n : fallback
  }
  const maxDiskBytes = (() => {
    const value = input.max_disk_mb
    if (value === false || value === 0) return null
    if (value === undefined) return DEFAULT_MAX_DISK_BYTES
    const bytes = Math.floor(Number(value) * 1024 * 1024)
    return Number.isFinite(bytes) && bytes >= 1 ? bytes : DEFAULT_MAX_DISK_BYTES
  })()
  return {
    maxBytes: positive(input.max_bytes, DEFAULT_MAX_BYTES),
    maxPerPrompt: positive(input.max_per_prompt, DEFAULT_MAX_PER_PROMPT),
    maxPromptBytes: positive(input.max_prompt_bytes, DEFAULT_MAX_PROMPT_BYTES),
    ttlMs: duration(input.ttl_ms, DEFAULT_TTL_MS),
    maxDiskBytes,
    // Derived, never a separate knob: the most objects the byte cap could ever admit.
    maxObjects: maxDiskBytes == null ? null : Math.floor(maxDiskBytes / (2 * ALLOC_BLOCK_BYTES)),
    evictionGraceMs: EVICTION_GRACE_MS,
  }
}

export const isValidKey = (key: string) => KEY_RE.test(String(key || ""))
export const isValidId = (id: string) => ID_RE.test(String(id || ""))
export const dirFor = (root: string, key: string) => path.join(root, key)
const fileFor = (root: string, key: string, id: string) => path.join(dirFor(root, key), id)
const sidecarOf = (file: string) => `${file}.meta`
const allocated = (logical: number) =>
  Math.max(1, Math.ceil(Math.max(0, Number(logical) || 0) / ALLOC_BLOCK_BYTES)) * ALLOC_BLOCK_BYTES

/** The bytes decide the type; a claimed content-type is ignored. SVG and GIF are refused by design. */
export function detectImageType(buffer: Buffer): { mime: string; ext: string } | null {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  )
    return { mime: "image/png", ext: "png" }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" }
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP")
    return { mime: "image/webp", ext: "webp" }
  return null
}

/** Best-effort pixel geometry from the header; a miss is a display hint missing, nothing more. */
export function imageDimensions(b: Buffer, mime: string): { width: number; height: number } | null {
  if (!Buffer.isBuffer(b)) return null
  try {
    if (mime === "image/png") {
      if (b.length < 24 || b.toString("ascii", 12, 16) !== "IHDR") return null
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
    }
    if (mime === "image/jpeg") {
      const len = b.length
      let offset = 2
      while (offset + 1 < len) {
        if (b[offset] !== 0xff) {
          offset += 1
          continue
        }
        let marker = b[offset + 1]!
        while (marker === 0xff && offset + 2 < len) {
          offset += 1
          marker = b[offset + 1]!
        }
        offset += 2
        if (marker === 0x01 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
        if (offset + 1 >= len) break
        const segment = b.readUInt16BE(offset)
        const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
        if (frame) {
          if (offset + 7 >= len) break
          return { height: b.readUInt16BE(offset + 3), width: b.readUInt16BE(offset + 5) }
        }
        offset += segment
      }
      return null
    }
    if (mime === "image/webp") {
      if (b.length < 25) return null
      const fourcc = b.toString("ascii", 12, 16)
      if (fourcc === "VP8 " && b.length >= 30)
        return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
      if (fourcc === "VP8L") {
        const b0 = b[21]!
        const b1 = b[22]!
        const b2 = b[23]!
        const b3 = b[24]!
        return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) }
      }
      if (fourcc === "VP8X" && b.length >= 30)
        return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) }
    }
  } catch {
    return null
  }
  return null
}

const meta = (id: string, file: string, mime: string, bytes: number, dims: { width: number; height: number } | null): Meta => ({
  id,
  type: "image",
  path: file,
  mime,
  bytes,
  width: dims?.width || 0,
  height: dims?.height || 0,
})

const exists = async (file: string) => {
  try {
    await stat(file)
    return true
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") return false
    throw error
  }
}

async function writeAtomically(file: string, content: Buffer | string) {
  const temporary = `${file}.${process.pid}.${++temporaryFileId}.tmp`
  try {
    // The mode is applied at creation and rename keeps it: never briefly world-readable.
    await writeFile(temporary, content, { mode: FILE_MODE })
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

async function readSidecarDims(file: string) {
  try {
    const parsed = JSON.parse(await readFile(sidecarOf(file), "utf8")) as { width?: unknown; height?: unknown }
    const width = Number(parsed?.width)
    const height = Number(parsed?.height)
    if (Number.isFinite(width) && Number.isFinite(height) && (width > 0 || height > 0)) return { width, height }
  } catch {
    // No sidecar or unreadable: the caller parses the header instead.
  }
  return null
}

/** Screenshots can hold anything on screen, and the data dir sits in a home directory: owner-only. */
async function ensureDir(root: string, key: string) {
  const dir = dirFor(root, key)
  await mkdir(dir, { recursive: true, mode: DIR_MODE })
  for (const target of [root, dir]) await chmod(target, DIR_MODE).catch(() => {})
  return dir
}

export interface WriteOptions extends Partial<Config> {
  /** `<key>/<id>` strings the sweep must keep. */
  readonly referenced?: ReadonlySet<string>
  readonly touchFile?: (file: string, atime: Date, mtime: Date) => Promise<void>
}

/**
 * The single admission chokepoint: every write that adds bytes routes its charge through here.
 * Reclaim unreferenced and expired bytes toward (quota − charge), then measure what is truly
 * committed and refuse when it still would not fit — everything left is referenced or fresh.
 */
async function admit(root: string, charge: number, options: WriteOptions) {
  const maxDiskBytes = options.maxDiskBytes ?? null
  if (maxDiskBytes == null || charge <= 0) return true
  await sweep(root, {
    ttlMs: options.ttlMs ?? null,
    maxDiskBytes: Math.max(0, maxDiskBytes - charge),
    maxObjects: options.maxObjects ?? null,
    referenced: options.referenced ?? new Set(),
    evictionGraceMs: options.evictionGraceMs ?? 0,
  })
  return (await committedBytes(root)) + charge <= maxDiskBytes
}

/**
 * Validate by size and magic bytes, hash, write atomically. Identical content dedupes to the same
 * file (and refreshes its mtime, so a new reference restarts the clock). Errors carry a status.
 */
export async function write(root: string, key: string, buffer: Buffer, options: WriteOptions = {}): Promise<Meta> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  if (!isValidKey(key)) throw new StoreError(`invalid attachment key: ${key}`, 400)
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new StoreError("empty attachment upload", 400)
  if (buffer.length > maxBytes) throw new StoreError(`attachment exceeds the ${maxBytes} byte limit`, 413)
  const type = detectImageType(buffer)
  if (!type) throw new StoreError("unsupported image type (expected PNG, JPEG, or WebP)", 415)
  const id = `${createHash("sha256").update(buffer).digest("hex")}.${type.ext}`
  const file = fileFor(root, key, id)
  const dims = imageDimensions(buffer, type.mime)
  const sidecar = JSON.stringify({ v: 1, mime: type.mime, bytes: buffer.length, width: dims?.width || 0, height: dims?.height || 0 })
  // The admission sweep must never evict the file this write dedupes into.
  const referenced = new Set(options.referenced ?? [])
  referenced.add(`${key}/${id}`)
  const admission = { ...options, referenced }
  if (!(await exists(file))) {
    const charge = allocated(buffer.length) + allocated(sidecar.length)
    if (!(await admit(root, charge, admission))) throw new StoreError("attachment storage is full", 507)
    await ensureDir(root, key)
    await writeAtomically(file, buffer)
    await writeAtomically(sidecarOf(file), sidecar).catch(() => {})
  } else {
    const now = new Date()
    try {
      await (options.touchFile ?? utimes)(file, now, now)
    } catch {
      // The refresh is load-bearing; rewriting identical bytes refreshes the mtime another way.
      await writeAtomically(file, buffer)
    }
    if (!(await exists(sidecarOf(file))) && (await admit(root, allocated(sidecar.length), admission))) {
      await writeAtomically(sidecarOf(file), sidecar).catch(() => {})
    }
  }
  return meta(id, file, type.mime, buffer.length, dims)
}

/** The trust boundary: a client id becomes what is on disk, or nothing. */
export async function resolve(root: string, key: string, id: string): Promise<Meta | null> {
  if (!isValidKey(key) || !isValidId(id)) return null
  const file = fileFor(root, key, id)
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(file)
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") return null
    throw error
  }
  if (!info.isFile()) return null
  const mime = MIME_BY_EXT[id.slice(id.lastIndexOf(".") + 1)]!
  const dims =
    (await readSidecarDims(file)) ??
    (await readFile(file)
      .then((b) => imageDimensions(b, mime))
      .catch(() => null))
  return meta(id, file, mime, info.size, dims)
}

/** For serving: one stat, the mime from the validated id, no image read. */
export async function statForServe(root: string, key: string, id: string) {
  if (!isValidKey(key) || !isValidId(id)) return null
  const file = fileFor(root, key, id)
  try {
    if (!(await stat(file)).isFile()) return null
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") return null
    throw error
  }
  return { file, mime: MIME_BY_EXT[id.slice(id.lastIndexOf(".") + 1)]! }
}

async function removeFile(file: string) {
  // Sidecar first: a crash after removing the image would otherwise strand an uncounted sidecar.
  await rm(sidecarOf(file), { force: true }).catch(() => {})
  try {
    await rm(file, { force: true })
    return true
  } catch {
    return false
  }
}

export async function remove(root: string, key: string, id: string) {
  if (!isValidKey(key) || !isValidId(id)) return false
  const file = fileFor(root, key, id)
  await rm(sidecarOf(file), { force: true }).catch(() => {})
  try {
    await rm(file)
    return true
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") return false
    throw error
  }
}

const readdirSafe = async (dir: string) => {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") return []
    throw error
  }
}

export interface Stored {
  readonly key: string
  readonly id: string
  readonly path: string
  readonly bytes: number
  readonly chargedBytes: number
  readonly mtimeMs: number
}

/** Every well-formed file; temps, sidecars and foreign entries are not attachments. */
export async function list(root: string): Promise<Stored[]> {
  const out: Stored[] = []
  for (const dirent of await readdirSafe(root)) {
    if (!dirent.isDirectory() || !isValidKey(dirent.name)) continue
    const dir = path.join(root, dirent.name)
    for (const entry of await readdirSafe(dir)) {
      if (!entry.isFile() || !isValidId(entry.name)) continue
      const file = path.join(dir, entry.name)
      try {
        const info = await stat(file)
        let sidecarBytes = 0
        try {
          sidecarBytes = (await stat(sidecarOf(file))).size
        } catch {
          // No sidecar: it adds no charge.
        }
        out.push({
          key: dirent.name,
          id: entry.name,
          path: file,
          bytes: info.size,
          chargedBytes: allocated(info.size) + (sidecarBytes > 0 ? allocated(sidecarBytes) : 0),
          mtimeMs: info.mtimeMs,
        })
      } catch {
        // Raced with a delete.
      }
    }
  }
  return out
}

/** The true committed allocation, debris included, at the same block cost the quota measures. */
async function committedBytes(root: string) {
  let total = 0
  for (const dirent of await readdirSafe(root)) {
    if (!dirent.isDirectory() || !isValidKey(dirent.name)) continue
    const dir = path.join(root, dirent.name)
    for (const entry of await readdirSafe(dir)) {
      if (!entry.isFile()) continue
      try {
        total += allocated((await stat(path.join(dir, entry.name))).size)
      } catch {
        // Raced with a delete.
      }
    }
  }
  return total
}

export interface SweepOptions {
  readonly ttlMs?: number | null
  readonly maxDiskBytes?: number | null
  readonly maxObjects?: number | null
  readonly referenced?: ReadonlySet<string>
  readonly now?: number
  readonly evictionGraceMs?: number
}

/**
 * Reference-aware cleanup. A file goes only when it is both past its TTL and unreferenced; then
 * the oldest unreferenced files past the quota, then the object bound — never a referenced file,
 * never one younger than the grace. Crash-orphaned temps and orphan sidecars are reaped regardless.
 */
export async function sweep(root: string, options: SweepOptions = {}) {
  const {
    ttlMs = DEFAULT_TTL_MS,
    maxDiskBytes = null,
    maxObjects = null,
    referenced = new Set<string>(),
    now = Date.now(),
    evictionGraceMs = 0,
  } = options
  const files = await list(root)
  let deleted = 0
  let freedBytes = 0
  const survivors: (Stored & { referenced: boolean; evicted?: boolean })[] = []
  for (const file of files) {
    const isReferenced = referenced.has(`${file.key}/${file.id}`)
    const expired = ttlMs != null && now - file.mtimeMs > ttlMs
    if (!isReferenced && expired) {
      if (await removeFile(file.path)) {
        deleted += 1
        freedBytes += file.bytes
      } else survivors.push({ ...file, referenced: false })
    } else survivors.push({ ...file, referenced: isReferenced })
  }
  let chargedTotal = survivors.reduce((sum, file) => sum + file.chargedBytes, 0)
  let objectCount = survivors.length
  const evictOldest = async (over: () => boolean) => {
    const evictable = survivors
      .filter((file) => !file.evicted && !file.referenced && !(evictionGraceMs > 0 && now - file.mtimeMs < evictionGraceMs))
      .sort((a, b) => a.mtimeMs - b.mtimeMs)
    for (const file of evictable) {
      if (!over()) break
      if (await removeFile(file.path)) {
        file.evicted = true
        deleted += 1
        freedBytes += file.bytes
        chargedTotal -= file.chargedBytes
        objectCount -= 1
      }
    }
  }
  if (maxDiskBytes != null) await evictOldest(() => chargedTotal > maxDiskBytes)
  if (maxObjects != null) await evictOldest(() => objectCount > maxObjects)
  // Debris the caps cannot see: temps past the write grace, sidecars whose image is gone.
  for (const dirent of await readdirSafe(root)) {
    if (!dirent.isDirectory() || !isValidKey(dirent.name)) continue
    const dir = path.join(root, dirent.name)
    const entries = await readdirSafe(dir)
    const present = new Set(entries.filter((e) => e.isFile()).map((e) => e.name))
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const file = path.join(dir, entry.name)
      const orphan = SIDECAR_ORPHAN_RE.exec(entry.name)
      try {
        if (TEMP_RE.test(entry.name)) {
          const info = await stat(file)
          if (now - info.mtimeMs <= TEMP_GRACE_MS) continue
          if (await removeFile(file)) {
            deleted += 1
            freedBytes += info.size
          }
        } else if (orphan && !present.has(orphan[1]!)) {
          const info = await stat(file)
          if (await removeFile(file)) {
            deleted += 1
            freedBytes += info.size
          }
        }
      } catch {
        // Raced with a rename or delete.
      }
    }
  }
  for (const dirent of await readdirSafe(root)) {
    if (!dirent.isDirectory()) continue
    const dir = path.join(root, dirent.name)
    try {
      if ((await readdir(dir)).length === 0) await rm(dir, { recursive: true, force: true })
    } catch {
      // Best effort.
    }
  }
  return { deleted, freedBytes }
}

/** A client's `attachments` list, reduced to `{id, name}` refs; anything else is malformed. */
export function refs(raw: unknown): { refs: Ref[]; malformed: boolean } {
  if (raw === undefined || raw === null) return { refs: [], malformed: false }
  if (!Array.isArray(raw)) return { refs: [], malformed: true }
  const out: Ref[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object" || typeof (item as { id?: unknown }).id !== "string") return { refs: [], malformed: true }
    const id = (item as { id: string }).id
    const name = (item as { name?: unknown }).name
    out.push(typeof name === "string" && name ? { id, name: name.slice(0, 200) } : { id })
  }
  return { refs: out, malformed: false }
}

/**
 * All or nothing for a send: the cheap bounds first, without touching disk; then each ref becomes
 * what is on disk, under the per-note count and byte caps. One rejection fails the whole batch,
 * so the browser keeps its queue and can say which image to fix.
 */
export async function resolveAll(
  root: string,
  key: string,
  notes: readonly { readonly attachments?: unknown }[],
  config: Pick<Config, "maxPerPrompt" | "maxPromptBytes">,
): Promise<{ resolved: Meta[][]; rejected: Rejection[] }> {
  const parsed = notes.map((note) => refs(note.attachments))
  const rejected: Rejection[] = []
  for (const p of parsed) if (p.malformed) rejected.push({ id: "", name: "", reason: "malformed" })
  if (rejected.length) return { resolved: [], rejected }
  for (const p of parsed) {
    if (p.refs.length > config.maxPerPrompt)
      rejected.push({ id: p.refs[0]?.id ?? "", name: p.refs[0]?.name ?? "", reason: "too-many" })
  }
  if (rejected.length) return { resolved: [], rejected }
  if (parsed.reduce((sum, p) => sum + p.refs.length, 0) > MAX_REQUEST_REFS)
    return { resolved: [], rejected: [{ id: "", name: "", reason: "too-many-in-request" }] }
  const resolved: Meta[][] = []
  for (const p of parsed) {
    const own: Meta[] = []
    let total = 0
    for (const ref of p.refs) {
      const found = await resolve(root, key, ref.id)
      if (!found) {
        rejected.push({ id: ref.id, name: ref.name ?? "", reason: "not-found" })
        continue
      }
      if (total + found.bytes > config.maxPromptBytes) {
        rejected.push({ id: ref.id, name: ref.name ?? "", reason: "prompt-bytes-exceeded" })
        continue
      }
      total += found.bytes
      own.push(ref.name ? { ...found, name: ref.name } : found)
    }
    resolved.push(own)
  }
  return rejected.length ? { resolved: [], rejected } : { resolved, rejected }
}

export * as DesignAttachments from "./attachments"
