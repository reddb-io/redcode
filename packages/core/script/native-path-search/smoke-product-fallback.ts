/** Exercise the integrated fallback using the real DLL and an injected discovery failure. */
import path from "node:path"
import { Effect, Layer } from "effect"
import { FileSystem } from "@opencode/schema/filesystem"
import { FileSystemSearch } from "../../src/filesystem/search.js"
import { loadNucleoLibrary } from "../../src/filesystem/search-native.bun.js"
import { Location } from "../../src/location.js"
import { Ripgrep } from "../../src/ripgrep.js"
import { AbsolutePath, RelativePath } from "../../src/schema.js"
import { location } from "../../test/fixture/location.js"

const library = process.argv[2]
if (!library) throw new Error("Expected native library path")
const loaded = loadNucleoLibrary(library)
if (!loaded.ok) throw loaded.error
let scans = 0
const refreshFault = process.argv.includes("--refresh")
const ripgrep = Ripgrep.Service.of({
  find: (input) => Effect.gen(function* () {
    scans++
    if (scans === (refreshFault ? 2 : 1)) return yield* Effect.die(new Error("injected discovery failure"))
    if (input.onEntry) yield* input.onEntry(FileSystem.Entry.make({ path: RelativePath.make("fallback-example.ts"), type: "file" }))
    return []
  }),
  glob: () => Effect.succeed([]),
  grep: () => Effect.succeed([]),
})
const dependencies = Layer.merge(
  Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(path.resolve(".")) }))),
  Layer.succeed(Ripgrep.Service, ripgrep),
)
const selected = FileSystemSearch.layer({ fff: false, native: { library } }).pipe(Layer.provide(dependencies))
await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const search = yield* FileSystemSearch.Service
  for (let index = 0; index < 2; index++) {
    const entries = yield* search.find({ query: "fallback-example" })
    if (!entries.some((entry) => entry.path === "fallback-example.ts")) throw new Error("Legacy fallback did not return the file")
  }
  if (refreshFault) {
    const deadline = Date.now() + 15_000
    while (scans < 3) {
      if (Date.now() > deadline) throw new Error("Failed background refresh did not trigger fallback")
      yield* Effect.sleep("100 millis")
      const entries = yield* search.find({ query: "fallback-example" })
      if (!entries.some((entry) => entry.path === "fallback-example.ts")) throw new Error("File missing during refresh fallback")
    }
  }
  const expected = refreshFault ? 3 : 2
  if (scans !== expected) throw new Error(`Expected ${expected} scans, got ${scans}`)
}).pipe(Effect.provide(selected))))
console.log(JSON.stringify({ passed: true, scans, fallback: "legacy" }))
