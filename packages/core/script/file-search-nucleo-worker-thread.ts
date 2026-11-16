/** Worker-owned Rust filename index used only by the FS-001 validation harness. */
import { CString, dlopen, FFIType, ptr } from "bun:ffi"
import { parentPort, workerData } from "node:worker_threads"

export type BuildRequest = { id: number; type: "build"; files: string[] }
export type FindRequest = {
  id: number
  type: "find"
  query: string
  kind: 0 | 1 | 2
  limit: number
}
export type CloseRequest = { id: number; type: "close" }
export type Request = BuildRequest | FindRequest | CloseRequest
export type Entry = { path: string; type: "file" | "directory" }
export type Response =
  | { type: "ready"; pid: number; runtimePid: number }
  | {
      id: number
      type: "done"
      entries?: Entry[]
      cpuMicros: number
      nativeWallMicros: number
      nativeThreadCpuMicros?: number
    }
  | { id: number; type: "error"; message: string }

const port = parentPort
if (!port) throw new Error("Filename search worker requires a parent port")
if (typeof workerData?.library !== "string" || workerData.library.length === 0)
  throw new Error("Filename search worker requires a native library")

const library = dlopen(workerData.library, {
  redcode_search_new: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.ptr },
  redcode_search_find: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.u32, FFIType.u64],
    returns: FFIType.ptr,
  },
  redcode_search_drop: { args: [FFIType.ptr], returns: FFIType.void },
  redcode_search_free_string: { args: [FFIType.ptr], returns: FFIType.void },
})
const system =
  process.platform === "win32"
    ? dlopen("kernel32.dll", {
        GetCurrentProcessId: { args: [], returns: FFIType.u32 },
        GetCurrentThread: { args: [], returns: FFIType.ptr },
        GetThreadTimes: {
          args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
          returns: FFIType.i32,
        },
      })
    : undefined
const pid = system?.symbols.GetCurrentProcessId() ?? process.pid
const thread = system?.symbols.GetCurrentThread()
const threadTimes = Array.from({ length: 4 }, () => Buffer.alloc(8))
const threadCpuMicros = () => {
  if (!system || !thread) return
  if (
    !system.symbols.GetThreadTimes(
      thread,
      ptr(threadTimes[0]!),
      ptr(threadTimes[1]!),
      ptr(threadTimes[2]!),
      ptr(threadTimes[3]!),
    )
  )
    return
  return Number(threadTimes[2]!.readBigUInt64LE() + threadTimes[3]!.readBigUInt64LE()) / 10
}
let handle: ReturnType<typeof library.symbols.redcode_search_new> = null

port.on("message", (request: Request) => {
  try {
    const started = process.cpuUsage()
    if (request.type === "build") {
      const bytes = Buffer.from(JSON.stringify(request.files))
      const nativeStarted = performance.now()
      const nativeCpuStarted = threadCpuMicros()
      const next = library.symbols.redcode_search_new(ptr(bytes), bytes.length)
      const nativeWallMicros = (performance.now() - nativeStarted) * 1_000
      const nativeCpuFinished = threadCpuMicros()
      if (!next) throw new Error("Rust filename index creation failed")
      const previous = handle
      handle = next
      if (previous) library.symbols.redcode_search_drop(previous)
      const usage = process.cpuUsage(started)
      port.postMessage({
        id: request.id,
        type: "done",
        cpuMicros: usage.user + usage.system,
        nativeWallMicros,
        nativeThreadCpuMicros:
          nativeCpuStarted === undefined || nativeCpuFinished === undefined
            ? undefined
            : nativeCpuFinished - nativeCpuStarted,
      } satisfies Response)
      return
    }
    if (request.type === "find") {
      if (!handle) throw new Error("Rust filename index unavailable")
      const bytes = Buffer.from(request.query + "\0")
      const nativeStarted = performance.now()
      const nativeCpuStarted = threadCpuMicros()
      const result = library.symbols.redcode_search_find(
        handle,
        ptr(bytes),
        bytes.length - 1,
        request.kind,
        request.limit,
      )
      const nativeWallMicros = (performance.now() - nativeStarted) * 1_000
      const nativeCpuFinished = threadCpuMicros()
      if (!result) throw new Error("Rust filename search failed")
      try {
        const entries = JSON.parse(new CString(result).toString()) as Entry[]
        const usage = process.cpuUsage(started)
        port.postMessage({
          id: request.id,
          type: "done",
          entries,
          cpuMicros: usage.user + usage.system,
          nativeWallMicros,
          nativeThreadCpuMicros:
            nativeCpuStarted === undefined || nativeCpuFinished === undefined
              ? undefined
              : nativeCpuFinished - nativeCpuStarted,
        } satisfies Response)
      } finally {
        library.symbols.redcode_search_free_string(result)
      }
      return
    }
    if (handle) library.symbols.redcode_search_drop(handle)
    handle = null
    const usage = process.cpuUsage(started)
    port.postMessage({
      id: request.id,
      type: "done",
      cpuMicros: usage.user + usage.system,
      nativeWallMicros: 0,
      nativeThreadCpuMicros: 0,
    } satisfies Response)
    port.close()
  } catch (error) {
    port.postMessage({
      id: request.id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    } satisfies Response)
  }
})
port.postMessage({ type: "ready", pid, runtimePid: process.pid } satisfies Response)
