/** Verify a build completing after disposal cannot publish a new index. */
import path from "node:path"
import { Effect, Layer } from "effect"
import { FileSystem } from "@opencode/schema/filesystem"
import { loadNucleoLibrary, nucleoRuntime } from "../../src/filesystem/search-native.bun.js"
import { Location } from "../../src/location.js"
import { Ripgrep } from "../../src/ripgrep.js"
import { AbsolutePath, RelativePath } from "../../src/schema.js"
import { location } from "../../test/fixture/location.js"

const library = process.argv[2]
if (!library) throw new Error("Expected native library path")
const loaded = loadNucleoLibrary(path.resolve(library))
if (!loaded.ok) throw loaded.error
let dispose: () => void = () => { throw new Error("Runtime not initialized") }
let started = 0
const dependencies = Layer.merge(
  Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(path.resolve(".")) }))),
  Layer.succeed(Ripgrep.Service, Ripgrep.Service.of({
    find: (input) => Effect.gen(function* () {
      if (input.onEntry) yield* input.onEntry(FileSystem.Entry.make({ path: RelativePath.make("example.ts"), type: "file" }))
      return []
    }),
    glob: () => Effect.succeed([]),
    grep: () => Effect.succeed([]),
  })),
)
await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const runtime = yield* nucleoRuntime(loaded.library, { asyncBuild: true, onBuildStart: () => { started++; dispose() } })
  dispose = () => Effect.runSync(runtime.dispose)
  const result = yield* Effect.exit(runtime.service.find({ query: "example" }))
  if (started !== 1 || result._tag !== "Failure") throw new Error("Disposed build was published or unexpectedly succeeded")
}).pipe(Effect.provide(dependencies))))
console.log(JSON.stringify({ passed: true, builds: started, publishedAfterDispose: false }))
