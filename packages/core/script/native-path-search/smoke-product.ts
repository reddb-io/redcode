/** Exercise the production selector from a compiled executable beside its native library. */
import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { FileSystem } from "@opencode/schema/filesystem"
import { FileSystemSearch } from "../../src/filesystem/search.js"
import { loadNucleoLibrary } from "../../src/filesystem/search-native.bun.js"
import { Location } from "../../src/location.js"
import { Ripgrep } from "../../src/ripgrep.js"
import { AbsolutePath, RelativePath } from "../../src/schema.js"
import { location } from "../../test/fixture/location.js"

const filename = process.platform === "win32" ? "redcode_path_search.dll" : process.platform === "darwin" ? "libredcode_path_search.dylib" : "libredcode_path_search.so"
delete process.env.REDCODE_PATH_SEARCH_LIBRARY
delete process.env.REDCODE_PATH_SEARCH_MODE
const library = path.join(path.dirname(process.execPath), filename)
const loaded = loadNucleoLibrary(library)
if (!loaded.ok) throw loaded.error
const fixturePath = process.argv[2]
if (!fixturePath) throw new Error("Expected contract fixture path")
const contract = await Bun.file(fixturePath).json() as {
  files: string[]
  cases: Array<{ id: string; query: string; type: string; limit: number; exactCount?: number; first?: string; required?: string[] }>
}

await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const loc = Location.Service.of(location({ directory: AbsolutePath.make(path.resolve(".")) }))
  const ripgrep = Ripgrep.Service.of({
    find: (input) => Effect.gen(function* () {
      if (input.onEntry) yield* Effect.forEach(contract.files, (file) => input.onEntry!(FileSystem.Entry.make({ path: RelativePath.make(file), type: "file" })), { discard: true })
      return []
    }),
    glob: () => Effect.succeed([]),
    grep: () => Effect.succeed([]),
  })
  const dependencies = Layer.merge(Layer.succeed(Location.Service, loc), Layer.succeed(Ripgrep.Service, ripgrep))
  const services = yield* Layer.build(FileSystemSearch.layer().pipe(Layer.provide(dependencies)))
  const search = Context.get(services, FileSystemSearch.Service)
  for (const item of contract.cases) {
    const entries = yield* search.find({ query: item.query, type: item.type === "mixed" ? undefined : item.type as "file" | "directory", limit: item.limit })
    const paths = entries.map((entry) => entry.path.replaceAll("\\", "/"))
    if (paths.length > item.limit || new Set(paths).size !== paths.length ||
      (item.exactCount !== undefined && paths.length !== item.exactCount) ||
      (item.first !== undefined && paths[0] !== item.first) ||
      item.required?.some((required) => !paths.includes(required)) ||
      (item.type !== "mixed" && entries.some((entry) => entry.type !== item.type)))
      throw new Error(`Production selector contract failed: ${item.id}`)
  }
})))
console.log(JSON.stringify({ passed: true, cases: contract.cases.length, library: filename }))
