import fs from "node:fs/promises"
import path from "node:path"
import { Flock } from "../util/flock"

export const MAX_BYTES = 10 * 1024 * 1024
export const MAX_FILES = 5
const warned = new Set<string>()

/** Hold the lock through close; other processes must never append to a renamed inode. */
export async function append(file: string, entries: readonly string[], maxBytes = MAX_BYTES) {
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 64) throw new Error("Invalid log size limit")
    const target = path.resolve(file)
    const locks = path.join(path.dirname(target), ".locks")
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await fs.mkdir(locks, { recursive: true, mode: 0o700 })
    await Flock.withLock(
      `log:${target}`,
      async () => {
        // Bound a pre-rotation log left by an older release as well as retained archives.
        for (let index = MAX_FILES - 1; index >= 0; index--) {
          await cap(index === 0 ? target : `${target}.${index}`, maxBytes)
        }
        let size = await fs.stat(target).then((value) => value.size, missing)
        let pending: Buffer[] = []
        const flush = async () => {
          const handle = await fs.open(target, "a", 0o600)
          try {
            if (process.platform !== "win32") await handle.chmod(0o600)
            if (pending.length) await handle.writeFile(Buffer.concat(pending))
            pending = []
          } finally {
            await handle.close()
          }
        }
        for (const entry of entries) {
          const line = bounded(entry, maxBytes)
          if (size + line.length > maxBytes) {
            await flush()
            await fs.rm(`${target}.${MAX_FILES - 1}`, { force: true })
            for (let index = MAX_FILES - 2; index >= 0; index--) {
              await fs.rename(index === 0 ? target : `${target}.${index}`, `${target}.${index + 1}`).catch(missing)
            }
            size = 0
          }
          pending.push(line)
          size += line.length
        }
        await flush()
      },
      { dir: locks, timeoutMs: 1500, baseDelayMs: 10, maxDelayMs: 100 },
    )
    return true
  } catch (error) {
    if (!warned.has(file)) {
      warned.add(file)
      const code = error !== null && typeof error === "object" && "code" in error ? String(error.code) : "write failed"
      // Filesystem error messages can include caller input; report only the location and code.
      try {
        process.stderr.write(`redcode: cannot write diagnostic log ${file} (${code}); continuing without this batch\n`)
      } catch {
        // Broken stderr must not turn a failed diagnostic write into a process failure.
      }
    }
    return false
  }
}

/** Preserve UTF-8 and the newline even for one unexpectedly huge record. */
function bounded(entry: string, maxBytes: number) {
  const bytes = Buffer.from(entry.endsWith("\n") ? entry : entry + "\n")
  if (bytes.length <= maxBytes) return bytes
  const suffix = Buffer.from(" [truncated]\n")
  let end = maxBytes - suffix.length
  while ((bytes[end]! & 0xc0) === 0x80) end--
  return Buffer.concat([bytes.subarray(0, end), suffix])
}

async function cap(file: string, maxBytes: number) {
  const info = await fs.lstat(file).catch((error) => {
    missing(error)
    return undefined
  })
  if (!info) return
  if (!info.isFile() || info.nlink !== 1) throw new Error("Diagnostic log is not a private regular file")
  if (process.platform !== "win32") await fs.chmod(file, 0o600)
  if (info.size <= maxBytes) return
  const handle = await fs.open(file, "r+")
  try {
    const bytes = Buffer.alloc(maxBytes)
    const result = await handle.read(bytes, 0, maxBytes, info.size - maxBytes)
    let start = 0
    while (start < result.bytesRead && (bytes[start]! & 0xc0) === 0x80) start++
    const newline = bytes.indexOf(10, start)
    if (newline >= start && newline < result.bytesRead - 1) start = newline + 1
    await handle.truncate(0)
    await handle.writeFile(bytes.subarray(start, result.bytesRead))
  } finally {
    await handle.close()
  }
}

function missing(error: unknown) {
  if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return 0
  throw error
}

export * as LogFile from "./log-file"
