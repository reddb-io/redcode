/** FS-001 validation adapter: Rust owns matching while a worker keeps FFI off the event loop. */
import path from "node:path"
import { Worker } from "node:worker_threads"
import { Clock, Deferred, Effect, Layer, Scope } from "effect"
import { FileSystem } from "@opencode/schema/filesystem"
import { FileSystemSearch } from "../src/filesystem/search"
import { Protected } from "../src/filesystem/protected"
import { Location } from "../src/location"
import { Ripgrep } from "../src/ripgrep"
import { RelativePath } from "../src/schema"
import type {
  BuildRequest,
  CloseRequest,
  Entry,
  FindRequest,
  Request,
  Response,
} from "./file-search-nucleo-worker-thread"

const REFRESH_INTERVAL = 10_000

export interface NucleoWorkerDiagnostics {
  cpuMicros: number
  nativeWallMicros: number
  nativeThreadCpuMicros: number
  pids: Set<number>
  runtimePids: Set<number>
}

interface Snapshot {
  find(input: FileSystem.FindInput): Promise<Entry[]>
  retire(): Promise<void>
}

function spawn(filepath: string, files: string[], diagnostics: NucleoWorkerDiagnostics): Promise<Snapshot> {
  const worker = new Worker(new URL("./file-search-nucleo-worker-thread.ts", import.meta.url), {
    workerData: { library: filepath },
  })
  worker.unref()
  let sequence = 0
  let queue: Promise<unknown> = Promise.resolve()
  let active = 0
  let retired = false
  let closed = false
  let finishRetire: (() => void) | undefined

  const ready = new Promise<void>((resolve, reject) => {
    const message = (response: Response) => {
      if (response.type !== "ready") return
      cleanup()
      diagnostics.pids.add(response.pid)
      diagnostics.runtimePids.add(response.runtimePid)
      resolve()
    }
    const error = (cause: Error) => {
      cleanup()
      reject(cause)
    }
    const exit = (code: number) => {
      cleanup()
      reject(new Error(`Filename search worker exited before ready with code ${code}`))
    }
    const cleanup = () => worker.off("message", message).off("error", error).off("exit", exit)
    worker.on("message", message).once("error", error).once("exit", exit)
  })

  type RequestInput = Omit<BuildRequest, "id"> | Omit<FindRequest, "id"> | Omit<CloseRequest, "id">
  const identify = (request: RequestInput, id: number): Request => {
    if (request.type === "build") return { ...request, id }
    if (request.type === "find") return { ...request, id }
    return { ...request, id }
  }
  const once = (request: RequestInput) =>
    ready.then(
      () =>
        new Promise<Extract<Response, { type: "done" }>>((resolve, reject) => {
          const id = ++sequence
          const message = (response: Response) => {
            if (response.type === "ready" || response.id !== id) return
            cleanup()
            if (response.type === "error") reject(new Error(response.message))
            else {
              diagnostics.cpuMicros += response.cpuMicros
              diagnostics.nativeWallMicros += response.nativeWallMicros
              diagnostics.nativeThreadCpuMicros += response.nativeThreadCpuMicros ?? 0
              resolve(response)
            }
          }
          const error = (cause: Error) => {
            cleanup()
            reject(cause)
          }
          const exit = (code: number) => {
            cleanup()
            reject(new Error(`Filename search worker exited with code ${code}`))
          }
          const cleanup = () => {
            worker.off("message", message).off("error", error).off("exit", exit)
            worker.unref()
          }
          worker.on("message", message).once("error", error).once("exit", exit)
          worker.ref()
          worker.postMessage(identify(request, id))
        }),
    )
  const request = (input: RequestInput) => {
    const result = queue.then(() => once(input))
    queue = result.catch(() => undefined)
    return result
  }
  const close = () => {
    if (closed) return queue.then(() => undefined)
    closed = true
    return request({ type: "close" })
      .then(() => undefined)
      .finally(() => worker.terminate())
  }
  const release = () => {
    active--
    if (retired && active === 0) finishRetire?.()
  }

  return ready
    .then(() => request({ type: "build", files }))
    .then<Snapshot>(() => ({
      find(input: FileSystem.FindInput) {
        if (retired || closed) return Promise.reject(new Error("Filename search snapshot is closed"))
        active++
        return request({
          type: "find",
          query: input.query,
          kind: input.type === "file" ? 1 : input.type === "directory" ? 2 : 0,
          limit: input.limit ?? 50,
        })
          .then((response) => response.entries ?? [])
          .finally(release)
      },
      retire() {
        retired = true
        if (active === 0) return close()
        return new Promise<void>((resolve) => {
          finishRetire = () => void close().finally(resolve)
        })
      },
    }))
    .catch((error) => {
      void worker.terminate()
      throw error
    })
}

export function nucleoWorkerLayer(
  filepath: string,
  diagnostics: NucleoWorkerDiagnostics = {
    cpuMicros: 0,
    nativeWallMicros: 0,
    nativeThreadCpuMicros: 0,
    pids: new Set(),
    runtimePids: new Set(),
  },
) {
  return Layer.effect(
    FileSystemSearch.Service,
    Effect.gen(function* () {
      const location = yield* Location.Service
      const ripgrep = yield* Ripgrep.Service
      const scope = yield* Scope.Scope
      const clock = yield* Clock.Clock
      const home = Protected.isHome(location.directory)
      let snapshot: Snapshot | undefined
      let settledAt = Number.NEGATIVE_INFINITY
      let refreshing: Deferred.Deferred<void> | undefined
      yield* Effect.addFinalizer(() => (snapshot ? Effect.promise(() => snapshot!.retire()) : Effect.void))
      const scan = Effect.gen(function* () {
        const files: string[] = []
        yield* ripgrep.find({
          cwd: location.directory,
          pattern: "*",
          limit: location.vcs && !home ? Number.MAX_SAFE_INTEGER : 100_000,
          exclude: home ? [...Protected.names()].map((name) => `${name}/**`) : undefined,
          onEntry: (entry) =>
            Effect.sync(() => {
              files.push(entry.path)
            }),
        })
        const next = yield* Effect.promise(() => spawn(filepath, files, diagnostics))
        const previous = snapshot
        snapshot = next
        if (previous) yield* Effect.promise(() => previous.retire())
      }).pipe(Effect.orDie)
      const refresh = Effect.suspend(() => {
        if (refreshing) return snapshot ? Effect.void : Deferred.await(refreshing)
        if (snapshot && clock.currentTimeMillisUnsafe() < settledAt + REFRESH_INTERVAL) return Effect.void
        const attempt = Deferred.makeUnsafe<void>()
        refreshing = attempt
        return scan.pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              settledAt = clock.currentTimeMillisUnsafe()
              if (refreshing === attempt) refreshing = undefined
              Deferred.doneUnsafe(attempt, exit)
            }),
          ),
          Effect.forkIn(scope),
          Effect.flatMap(() => (snapshot ? Effect.void : Deferred.await(attempt))),
        )
      })
      return FileSystemSearch.Service.of({
        find: (input) =>
          Effect.gen(function* () {
            yield* refresh
            const current = snapshot
            if (!current) throw new Error("Rust filename index unavailable")
            const entries = yield* Effect.promise(() => current.find(input))
            return entries.map((entry) =>
              FileSystem.Entry.make({
                path: RelativePath.make(entry.path.replace(/\/$/, "") + (entry.type === "directory" ? path.sep : "")),
                type: entry.type,
              }),
            )
          }),
      })
    }),
  )
}
