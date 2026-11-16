/** Compiled production selector against actual ripgrep discovery and file changes. */
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FileSystemSearch } from "../../src/filesystem/search.js"
import { loadNucleoLibrary } from "../../src/filesystem/search-native.bun.js"
import { Location } from "../../src/location.js"
import { Environment } from "../../src/environment/index.js"
import { Ripgrep } from "../../src/ripgrep.js"
import { RipgrepBinary } from "../../src/ripgrep/binary.js"
import { AbsolutePath } from "../../src/schema.js"
import { location } from "../../test/fixture/location.js"

delete process.env.REDCODE_PATH_SEARCH_LIBRARY
const filename = process.platform === "win32" ? "redcode_path_search.dll" : process.platform === "darwin" ? "libredcode_path_search.dylib" : "libredcode_path_search.so"
const loaded = loadNucleoLibrary(path.join(path.dirname(process.execPath), filename))
if (!loaded.ok) throw loaded.error
const rg = Bun.which("rg")
if (!rg) throw new Error("ripgrep is required")
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-path-search-smoke-"))
await fs.mkdir(path.join(directory, "src"))
await Bun.write(path.join(directory, ".gitignore"), "ignored-secret.txt\n")
await Bun.write(path.join(directory, "src", "visible-unique.ts"), "visible")
await Bun.write(path.join(directory, "ignored-secret.txt"), "ignored")
const init = Bun.spawnSync(["git", "init", "-q", directory])
if (init.exitCode !== 0) throw new Error("git init failed")
const local = Layer.effect(Environment.Service, Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner
  return Environment.Service.of({ spawner, files: Environment.makeFiles(Environment.makeLocalDriver(spawner)) })
})).pipe(Layer.provide(LayerNode.compile(CrossSpawnSpawner.node)))
const ripgrep = LayerNode.compile(Ripgrep.node, {
  replacements: [Environment.node.replace(local), RipgrepBinary.node.replace(Layer.succeed(RipgrepBinary.Service, { filepath: Effect.succeed(rg) }))],
})
const ref = Location.Ref.make({ directory: AbsolutePath.make(directory) })
const layer = FileSystemSearch.layer().pipe(
  Layer.provide(ripgrep),
  Layer.provide(Layer.succeed(Location.Service, Location.Service.of(location(ref, {
    vcs: { type: "git", store: AbsolutePath.make(path.join(directory, ".git")) },
  })))),
)
await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const search = yield* FileSystemSearch.Service
  const find = (query: string) => search.find({ query, type: "file" }).pipe(Effect.map((entries) => entries.map((entry) => entry.path.replaceAll("\\", "/"))))
  const initial = yield* find("visible-unique")
  if (!initial.includes("src/visible-unique.ts")) throw new Error("Real file missing from index")
  if ((yield* find("ignored-secret")).includes("ignored-secret.txt")) throw new Error("Ignored file was indexed")
  const waitFor = (query: string, expected: string, present: boolean) => Effect.gen(function* () {
    const deadline = Date.now() + 15_000
    while ((yield* find(query)).includes(expected) !== present) {
      if (Date.now() > deadline) throw new Error(`File change not reflected: ${expected}`)
      yield* Effect.sleep("100 millis")
    }
  })
  yield* Effect.promise(() => Bun.write(path.join(directory, "src", "created-unique.ts"), "created"))
  yield* waitFor("created-unique", "src/created-unique.ts", true)
  yield* Effect.promise(() => fs.rename(path.join(directory, "src", "created-unique.ts"), path.join(directory, "src", "renamed-unique.ts")))
  yield* waitFor("renamed-unique", "src/renamed-unique.ts", true)
  if ((yield* find("created-unique")).includes("src/created-unique.ts")) throw new Error("Old filename survived rename")
  yield* Effect.promise(() => fs.unlink(path.join(directory, "src", "renamed-unique.ts")))
  yield* waitFor("renamed-unique", "src/renamed-unique.ts", false)
}).pipe(Effect.provide(layer))))
console.log(JSON.stringify({ passed: true, discovery: "ripgrep", ignored: true, create: true, rename: true, delete: true }))
