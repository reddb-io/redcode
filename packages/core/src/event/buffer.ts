export * as EventBuffer from "./buffer.js"

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { mkdtemp, open, opendir, rmdir, unlink, type FileHandle } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { deserialize, serialize } from "node:v8"
import { Deferred, Effect, Queue, Schema, Semaphore, Stream } from "effect"
import { Event } from "@opencode/schema/event"

const MEMORY_EVENTS = 128
const MEMORY_BYTES = 1024 * 1024
const SEGMENT_BYTES = 4 * 1024 * 1024
const MAX_SCHEMAS = 1024
const viewPrototypes = new Set([
  Int8Array.prototype,
  Uint8Array.prototype,
  Uint8ClampedArray.prototype,
  Int16Array.prototype,
  Uint16Array.prototype,
  Int32Array.prototype,
  Uint32Array.prototype,
  Float32Array.prototype,
  Float64Array.prototype,
  BigInt64Array.prototype,
  BigUint64Array.prototype,
  DataView.prototype,
])

/** Unknown fields must round-trip: structured clone silently strips custom prototypes and symbols. */
function validate(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value === "function" || typeof value === "symbol")
    throw new Error("Event contains a non-serializable value")
  if (value === null || typeof value !== "object" || seen.has(value)) return
  seen.add(value)
  const prototype = Object.getPrototypeOf(value)
  if (value instanceof Date || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    if (Buffer.isBuffer(value)) throw new Error("Event contains a Buffer with an unsupported prototype")
    if (value instanceof Date && prototype !== Date.prototype) throw new Error("Event contains a Date subclass")
    if (value instanceof ArrayBuffer && prototype !== ArrayBuffer.prototype)
      throw new Error("Event contains an ArrayBuffer subclass")
    if (ArrayBuffer.isView(value)) {
      if (!viewPrototypes.has(prototype)) throw new Error("Event contains a typed array subclass")
      if (
        Object.getOwnPropertySymbols(value).length ||
        Object.getOwnPropertyNames(value).some((key) => !/^(0|[1-9]\d*)$/.test(key))
      )
        throw new Error("Event contains extra properties on a typed array")
      return
    }
    if (ownPropertyCount(value)) throw new Error("Event contains extra properties on a built-in value")
    return
  }
  if (value instanceof Map) {
    if (prototype !== Map.prototype || ownPropertyCount(value)) throw new Error("Event contains an unsupported Map")
    for (const [key, item] of value) {
      validate(key, seen)
      validate(item, seen)
    }
    return
  }
  if (value instanceof Set) {
    if (prototype !== Set.prototype || ownPropertyCount(value)) throw new Error("Event contains an unsupported Set")
    for (const item of value) validate(item, seen)
    return
  }
  if (prototype !== (Array.isArray(value) ? Array.prototype : Object.prototype))
    throw new Error("Event contains an object with an unsupported prototype")
  if (Object.getOwnPropertySymbols(value).length) throw new Error("Event contains a symbol key")
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !("value" in descriptor)) throw new Error("Event contains an accessor")
    if (!descriptor.enumerable && !(Array.isArray(value) && key === "length"))
      throw new Error("Event contains a non-enumerable property")
    validate(descriptor.value, seen)
  }
}

function ownPropertyCount(value: object) {
  return Object.getOwnPropertyNames(value).length + Object.getOwnPropertySymbols(value).length
}

/** Run before projections or durable commits so an unsupported event is never partially published. */
export function preflight(definition: Event.Definition, data: unknown, metadata?: Record<string, unknown>) {
  const encoded = { data: Schema.encodeUnknownSync(definition.data)(data), metadata }
  validate(encoded)
  serialize(encoded)
}

export function encode(event: Event.Payload, definition: Event.Definition) {
  return serialize({ ...event, data: Schema.encodeUnknownSync(definition.data)(event.data) })
}

export const make = Effect.fn("EventBuffer.make")(function* (options?: {
  readonly directory?: string
  readonly memoryEvents?: number
  readonly memoryBytes?: number
}) {
  const lock = Semaphore.makeUnsafe(1)
  const wake = yield* Queue.sliding<void>(1)
  const key = randomBytes(32)
  const limitEvents = options?.memoryEvents ?? MEMORY_EVENTS
  const limitBytes = options?.memoryBytes ?? MEMORY_BYTES
  const memory: { event: Event.Payload; bytes: number }[] = []
  const definitions = new Map<Event.Definition, number>()
  const byID = new Map<number, Event.Definition>()
  let memoryBytes = 0
  let maxRecordBytes = 0
  let emergency: { event: Event.Payload; done: Deferred.Deferred<void> } | undefined
  let disk:
    | {
        dir: string
        writer: FileHandle
        reader?: FileHandle
        readIndex: number
        writeIndex: number
        read: number
        write: number
      }
    | undefined
  let closed = false
  let cleanupFailed = false

  const warnCleanup = Effect.suspend(() => {
    if (!cleanupFailed) return Effect.void
    cleanupFailed = false
    return Effect.logWarning("Could not remove all encrypted event buffer files")
  })

  const clearDisk = async () => {
    if (!disk) return
    const current = disk
    disk = undefined
    const failed = () => {
      cleanupFailed = true
    }
    await current.reader?.close().catch(failed)
    await current.writer.close().catch(failed)
    const directory = await opendir(current.dir).catch(() => {
      failed()
      return undefined
    })
    if (directory) {
      try {
        for await (const file of directory)
          if (/^\d+$/.test(file.name)) await unlink(path.join(current.dir, file.name)).catch(failed)
      } catch {
        failed()
      }
    }
    await rmdir(current.dir).catch(failed)
    definitions.clear()
    byID.clear()
    maxRecordBytes = 0
  }
  const close = lock.withPermit(
    Effect.promise(async () => {
      closed = true
      memory.length = 0
      memoryBytes = 0
      if (emergency) Deferred.doneUnsafe(emergency.done, Effect.void)
      emergency = undefined
      await clearDisk()
      key.fill(0)
    }).pipe(Effect.andThen(warnCleanup), Effect.andThen(Queue.shutdown(wake))),
  )
  yield* Effect.addFinalizer(() => close)

  const append = async (event: Event.Payload, definition: Event.Definition, encoded: Uint8Array) => {
    if (!disk && memory.length < limitEvents && memoryBytes + encoded.byteLength <= limitBytes) {
      memory.push({ event, bytes: encoded.byteLength })
      memoryBytes += encoded.byteLength
      Queue.offerUnsafe(wake, undefined)
      return
    }
    if (!disk) {
      const dir = await mkdtemp(path.join(options?.directory ?? tmpdir(), "redcode-event-buffer-"))
      try {
        disk = {
          dir,
          writer: await open(path.join(dir, "0"), "wx+", 0o600),
          readIndex: 0,
          writeIndex: 0,
          read: 0,
          write: 0,
        }
      } catch (error) {
        await rmdir(dir).catch(() => undefined)
        throw error
      }
    }
    let id = definitions.get(definition)
    if (id === undefined) {
      if (definitions.size >= MAX_SCHEMAS) throw new Error("Event buffer schema capacity exceeded")
      id = definitions.size
      definitions.set(definition, id)
      byID.set(id, definition)
    }
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", key, iv)
    const schemaID = Buffer.allocUnsafe(4)
    schemaID.writeUInt32BE(id)
    cipher.setAAD(schemaID)
    const ciphertext = Buffer.concat([cipher.update(encoded), cipher.final()])
    const payload = Buffer.allocUnsafe(4 + 4 + 12 + 16 + ciphertext.byteLength)
    payload.writeUInt32BE(payload.byteLength - 4, 0)
    schemaID.copy(payload, 4)
    iv.copy(payload, 8)
    cipher.getAuthTag().copy(payload, 20)
    ciphertext.copy(payload, 36)
    if (disk.write && disk.write + payload.byteLength > SEGMENT_BYTES) {
      const next = await open(path.join(disk.dir, String(disk.writeIndex + 1)), "wx+", 0o600)
      await disk.writer.close()
      disk.writer = next
      disk.writeIndex++
      disk.write = 0
    }
    let written = 0
    while (written < payload.byteLength) {
      const result = await disk.writer.write(payload, written, payload.byteLength - written, disk.write + written)
      if (!result.bytesWritten) throw new Error("Could not write the event buffer")
      written += result.bytesWritten
    }
    disk.write += written
    maxRecordBytes = Math.max(maxRecordBytes, payload.byteLength - 4)
    Queue.offerUnsafe(wake, undefined)
  }

  const offer = (event: Event.Payload, definition: Event.Definition, bytes: Uint8Array = encode(event, definition)) =>
    Effect.gen(function* () {
      while (true) {
        const pending = yield* lock.withPermit(
          Effect.gen(function* () {
            if (closed) return undefined
            if (emergency) return { done: emergency.done, retry: true }
            const result = yield* Effect.tryPromise(() => append(event, definition, bytes)).pipe(Effect.result)
            if (result._tag === "Success") return undefined
            // If the disk is unavailable, retain this event and backpressure publishers until it is read.
            yield* Effect.logWarning("Event buffer cannot spill more data; waiting for the subscriber")
            const done = yield* Deferred.make<void>()
            emergency = { event, done }
            Queue.offerUnsafe(wake, undefined)
            return { done, retry: false }
          }).pipe(Effect.uninterruptible),
        )
        if (!pending) return
        yield* Deferred.await(pending.done)
        if (!pending.retry) return
      }
    })

  const take = Effect.gen(function* () {
    while (true) {
      const result = yield* lock.withPermit(
        Effect.tryPromise(async () => {
          const first = memory.shift()
          if (first) {
            memoryBytes -= first.bytes
            return first.event
          }
          if (!disk || (disk.readIndex === disk.writeIndex && disk.read === disk.write)) {
            if (!emergency) return undefined
            if (disk) await clearDisk()
            const item = emergency
            emergency = undefined
            Deferred.doneUnsafe(item.done, Effect.void)
            return item.event
          }
          if (disk.readIndex !== disk.writeIndex && !disk.reader)
            disk.reader = await open(path.join(disk.dir, String(disk.readIndex)), "r")
          const source = disk.reader ?? disk.writer
          const read = async (length: number, offset: number) => {
            const buffer = Buffer.allocUnsafe(length)
            let count = 0
            while (count < length) {
              const result = await source.read(buffer, count, length - count, offset + count)
              if (!result.bytesRead) throw new Error("Unexpected end of the event buffer")
              count += result.bytesRead
            }
            return buffer
          }
          const header = await read(4, disk.read)
          const size = header.readUInt32BE(0)
          if (size < 32 || size > maxRecordBytes) throw new Error("Invalid event buffer record size")
          const record = await read(size, disk.read + 4)
          const definition = byID.get(record.readUInt32BE(0))
          if (!definition) throw new Error("Unknown event buffer schema")
          const decipher = createDecipheriv("aes-256-gcm", key, record.subarray(4, 16))
          decipher.setAAD(record.subarray(0, 4))
          decipher.setAuthTag(record.subarray(16, 32))
          const encoded = Buffer.concat([decipher.update(record.subarray(32)), decipher.final()])
          const stored = deserialize(encoded) as Event.Payload
          const event = { ...stored, data: Schema.decodeUnknownSync(definition.data)(stored.data) } as Event.Payload
          const nextRead = disk.read + 4 + size
          const segmentDone = disk.readIndex < disk.writeIndex && nextRead === (await source.stat()).size
          disk.read = nextRead
          if (segmentDone) {
            await disk.reader?.close().catch(() => undefined)
            disk.reader = undefined
            await unlink(path.join(disk.dir, String(disk.readIndex))).catch(() => undefined)
            disk.readIndex++
            disk.read = 0
          }
          if (disk.readIndex === disk.writeIndex && disk.read === disk.write) await clearDisk()
          return event
        }).pipe(Effect.result, Effect.uninterruptible),
      )
      if (result._tag === "Failure") {
        yield* Effect.logWarning("Event buffer cannot read spilled data; retrying")
        yield* Effect.sleep("1 second")
        continue
      }
      yield* warnCleanup
      const value = result.success
      if (value) return value
      yield* Queue.take(wake)
    }
  })
  return { offer, stream: Stream.fromEffectRepeat(take), close }
})
