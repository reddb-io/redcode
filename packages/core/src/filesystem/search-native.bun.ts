/** Canonical Bun backend: retain ripgrep discovery and own matching/index storage in Rust. */
import { CString, dlopen, FFIType, ptr } from "bun:ffi"
import path from "node:path"
import { Cause, Clock, Deferred, Effect, Exit, Layer, Scope } from "effect"
import { FileSystem } from "@opencode/schema/filesystem"
import * as FileSystemSearch from "./search-contract.js"
import { Location } from "../location.js"
import { Ripgrep } from "../ripgrep.js"
import { RelativePath } from "../schema.js"
import { Protected } from "./protected.js"

export const available = true

function openLibrary(filepath: string) {
  const library = dlopen(filepath, {
    redcode_search_abi_version: { args: [], returns: FFIType.u32 },
    redcode_search_new: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.ptr },
    redcode_search_new_async: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.ptr },
    redcode_search_ready: { args: [FFIType.ptr], returns: FFIType.i32 },
    redcode_search_find: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.u32, FFIType.u64],
      returns: FFIType.ptr,
    },
    redcode_search_drop: { args: [FFIType.ptr], returns: FFIType.void },
    redcode_search_free_string: { args: [FFIType.ptr], returns: FFIType.void },
  })
  const version = library.symbols.redcode_search_abi_version()
  if (version === 1) return library
  library.close()
  const error = new Error(`Unsupported RedCode path search ABI: ${version}`) as Error & { code: string }
  error.code = "ERR_REDCODE_SEARCH_ABI"
  throw error
}
const libraries = new Map<string, ReturnType<typeof openLibrary>>()

export function loadNucleoLibrary(filepath: string) {
  const cached = libraries.get(filepath)
  if (cached) return { ok: true as const, library: cached }
  try {
    const library = openLibrary(filepath)
    libraries.set(filepath, library)
    return { ok: true as const, library }
  } catch (cause) {
    return { ok: false as const, error: cause instanceof Error ? cause : new Error(String(cause)) }
  }
}

export interface NucleoRuntimeOptions {
  asyncBuild?: boolean
  onBuildStart?: () => void
  /** PoC fault injection; never set by a product selection path. */
  fault?: "build" | "search"
}

export function nucleoRuntime(
  library: ReturnType<typeof openLibrary>,
  options: NucleoRuntimeOptions,
) {
  return Effect.gen(function* () {
      const location = yield* Location.Service
      const ripgrep = yield* Ripgrep.Service
      const scope = yield* Scope.Scope
      const clock = yield* Clock.Clock
      const home = Protected.isHome(location.directory)
      let handle: ReturnType<typeof library.symbols.redcode_search_new> = null
      let closed = false
      let settledAt = Number.NEGATIVE_INFINITY
      let refreshing: Deferred.Deferred<void> | undefined
      let refreshFailed = false
      const dispose = Effect.sync(() => {
        if (!closed) {
          if (handle) library.symbols.redcode_search_drop(handle)
          handle = null
          closed = true
        }
      })
      yield* Effect.addFinalizer(() => dispose)
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
        if (closed) throw new Error("Rust filename index closed")
        const bytes = options.fault === "build" ? Buffer.from("invalid") : Buffer.from(JSON.stringify(files))
        const next = options.asyncBuild
          ? library.symbols.redcode_search_new_async(ptr(bytes), bytes.length)
          : library.symbols.redcode_search_new(ptr(bytes), bytes.length)
        if (!next) throw new Error("Rust filename index creation failed")
        options.onBuildStart?.()
        if (options.asyncBuild)
          yield* Effect.gen(function* () {
            const deadline = clock.currentTimeMillisUnsafe() + 30_000
            while (true) {
              const status = library.symbols.redcode_search_ready(next)
              if (status === 1) break
              if (status < 0) throw new Error("Rust filename index construction failed")
              if (clock.currentTimeMillisUnsafe() >= deadline) throw new Error("Rust filename index construction timed out")
              yield* Effect.sleep("5 millis")
            }
          }).pipe(
            Effect.onExit((exit) =>
              Exit.isFailure(exit)
                ? Effect.sync(() => library.symbols.redcode_search_drop(next))
                : Effect.void,
            ),
          )
        if (closed) {
          library.symbols.redcode_search_drop(next)
          throw new Error("Rust filename index closed")
        }
        const previous = handle
        handle = next
        if (previous) library.symbols.redcode_search_drop(previous)
      }).pipe(Effect.orDie)
      const refresh = Effect.suspend(() => {
        if (refreshFailed) return Effect.die(new Error("Rust filename index refresh failed"))
        if (refreshing) return handle ? Effect.void : Deferred.await(refreshing)
        if (handle && clock.currentTimeMillisUnsafe() < settledAt + 10_000) return Effect.void
        const attempt = Deferred.makeUnsafe<void>()
        refreshing = attempt
        return scan.pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) refreshFailed = true
              settledAt = clock.currentTimeMillisUnsafe()
              if (refreshing === attempt) refreshing = undefined
              Deferred.doneUnsafe(attempt, exit)
            }),
          ),
          Effect.forkIn(scope),
          Effect.flatMap(() => (handle ? Effect.void : Deferred.await(attempt))),
        )
      })
      const service = FileSystemSearch.Service.of({
        find: (input) =>
          Effect.gen(function* () {
            if (closed) throw new Error("Rust filename index closed")
            yield* refresh
            if (!handle) throw new Error("Rust filename index unavailable")
            if (options.fault === "search") throw new Error("Injected Rust filename search failure")
            const bytes = Buffer.from(input.query + "\0")
            const result = library.symbols.redcode_search_find(
              handle,
              ptr(bytes),
              bytes.length - 1,
              input.type === "file" ? 1 : input.type === "directory" ? 2 : 0,
              input.limit ?? 50,
            )
            if (!result) throw new Error("Rust filename search failed")
            try {
              const entries = JSON.parse(new CString(result).toString()) as Array<{
                path: string
                type: "file" | "directory"
              }>
              return entries.map((entry) =>
                FileSystem.Entry.make({
                  path: RelativePath.make(entry.path.replace(/\/$/, "") + (entry.type === "directory" ? path.sep : "")),
                  type: entry.type,
                }),
              )
            } finally {
              library.symbols.redcode_search_free_string(result)
            }
          }),
      })
      return { service, dispose }
    })
}

export function loadedLayer(library: ReturnType<typeof openLibrary>, options: NucleoRuntimeOptions) {
  return Layer.effect(FileSystemSearch.Service, nucleoRuntime(library, options).pipe(Effect.map((runtime) => runtime.service)))
}

export function nucleoLayer(filepath: string, options: { asyncBuild?: boolean } = {}) {
  return Layer.unwrap(
    Effect.sync(() => {
      const loaded = loadNucleoLibrary(filepath)
      if (!loaded.ok) return Layer.effect(FileSystemSearch.Service, Effect.die(loaded.error))
      return loadedLayer(loaded.library, options)
    }),
  )
}

export function nucleoAsyncLayer(filepath: string) {
  return nucleoLayer(filepath, { asyncBuild: true })
}

export function tryNucleoAsyncLayer(filepath: string) {
  const loaded = loadNucleoLibrary(filepath)
  if (!loaded.ok) return loaded
  return { ok: true as const, layer: loadedLayer(loaded.library, { asyncBuild: true }) }
}

export function tryNucleoAsyncRuntime(filepath: string) {
  const loaded = loadNucleoLibrary(filepath)
  if (!loaded.ok) return loaded
  return { ok: true as const, runtime: nucleoRuntime(loaded.library, { asyncBuild: true }) }
}
