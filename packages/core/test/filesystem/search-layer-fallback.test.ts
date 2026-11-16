import { expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { FileSystem } from "@opencode/schema/filesystem"
import { FileSystemSearch } from "@opencode/core/filesystem/search"
import { Location } from "@opencode/core/location"
import { Ripgrep } from "@opencode/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode/core/schema"
import { location } from "../fixture/location"

/**
 * `layer({ native: { mode: "rust" } })` must roll back to the validated legacy search when the Rust
 * runtime fails. That wiring was missing: the runtime was returned directly, so a discovery failure
 * died instead of falling back. The smoke scripts in `script/native-path-search` prove the same
 * against a real library.
 */
const dependencies = Layer.mergeAll(
  Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make("/tmp/redcode-fallback-check") })),
  ),
  Layer.succeed(
    Ripgrep.Service,
    Ripgrep.Service.of({
      // The legacy index is built from streamed entries, not from find's return value.
      find: (input) =>
        Effect.gen(function* () {
          if (input.onEntry)
            yield* input.onEntry(FileSystem.Entry.make({ path: RelativePath.make("legacy.ts"), type: "file" }))
          return []
        }),
      glob: () => Effect.succeed([]),
      grep: () => Effect.succeed([]),
    }),
  ),
)

test("a Rust library that cannot load makes the layer fail rather than silently degrade", async () => {
  const layer = FileSystemSearch.layer({ fff: false, native: { mode: "rust", library: "/nonexistent/libredcode.so" } })
  const exit = await Effect.runPromiseExit(
    Effect.scoped(Layer.build(layer.pipe(Layer.provide(dependencies)))),
  )
  // A missing library fails the build; it must not quietly serve an empty index.
  expect(exit._tag).toBe("Failure")
})
test("without the rust mode the layer stays on the validated legacy search", async () => {
  const found = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(
          FileSystemSearch.layer({ fff: false }).pipe(Layer.provide(dependencies)),
        )
        const search = Context.get(context, FileSystemSearch.Service)
        return yield* search.find({ query: "legacy" })
      }),
    ) as Effect.Effect<ReadonlyArray<FileSystem.Entry>>,
  )
  expect(found.map((entry) => entry.path as string)).toContain("legacy.ts")
})