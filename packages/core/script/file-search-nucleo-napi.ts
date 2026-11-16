/** FS-001 validation adapter: napi-rs AsyncTask keeps Rust matching off the event loop. */
import { createRequire } from "node:module"
import path from "node:path"
import { Clock, Deferred, Effect, Layer, Scope } from "effect"
import { FileSystem } from "@opencode/schema/filesystem"
import { FileSystemSearch } from "../src/filesystem/search"
import { Protected } from "../src/filesystem/protected"
import { Location } from "../src/location"
import { Ripgrep } from "../src/ripgrep"
import { RelativePath } from "../src/schema"

interface Addon {
  createIndex(files: Buffer): Promise<number>
  searchIndex(id: number, query: string, kind: number, limit: number): Promise<string>
  searchIndexSync(id: number, query: string, kind: number, limit: number): string
  dropIndex(id: number): boolean
  indexCount(): number
}

interface Entry {
  path: string
  type: "file" | "directory"
}

const require = createRequire(import.meta.url)
const libraries = new Map<string, Addon>()
const REFRESH_INTERVAL = 10_000

function load(filepath: string) {
  const cached = libraries.get(filepath)
  if (cached) return cached
  const addon = require(filepath) as Addon
  libraries.set(filepath, addon)
  return addon
}

export function nucleoNapiLayer(filepath: string, mode: "async" | "sync" = "async") {
  return Layer.effect(
    FileSystemSearch.Service,
    Effect.gen(function* () {
      const addon = load(filepath)
      const location = yield* Location.Service
      const ripgrep = yield* Ripgrep.Service
      const scope = yield* Scope.Scope
      const clock = yield* Clock.Clock
      const home = Protected.isHome(location.directory)
      let index: number | undefined
      let settledAt = Number.NEGATIVE_INFINITY
      let refreshing: Deferred.Deferred<void> | undefined
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (index !== undefined) addon.dropIndex(index)
          index = undefined
        }),
      )
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
        const next = yield* Effect.promise(() => addon.createIndex(Buffer.from(JSON.stringify(files))))
        const previous = index
        index = next
        if (previous !== undefined) addon.dropIndex(previous)
      }).pipe(Effect.orDie)
      const refresh = Effect.suspend(() => {
        if (refreshing) return index === undefined ? Deferred.await(refreshing) : Effect.void
        if (index !== undefined && clock.currentTimeMillisUnsafe() < settledAt + REFRESH_INTERVAL) return Effect.void
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
          Effect.flatMap(() => (index === undefined ? Deferred.await(attempt) : Effect.void)),
        )
      })
      return FileSystemSearch.Service.of({
        find: (input) =>
          Effect.gen(function* () {
            yield* refresh
            const current = index
            if (current === undefined) throw new Error("Rust filename index unavailable")
            const kind = input.type === "file" ? 1 : input.type === "directory" ? 2 : 0
            const json =
              mode === "sync"
                ? addon.searchIndexSync(current, input.query, kind, input.limit ?? 50)
                : yield* Effect.promise(() => addon.searchIndex(current, input.query, kind, input.limit ?? 50))
            const entries = JSON.parse(json) as Entry[]
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
