/** PoC canary boundary. This is the only nucleo module allowed to import legacy search. */
import { Cause, Context, Effect, Layer } from "effect"
import { FileSystemSearch } from "../src/filesystem/search"
import { loadNucleoLibrary, nucleoRuntime } from "./file-search-nucleo"

export interface NucleoLoadDiagnostics {
  attempts: number
  failures: number
  runtimeFailures: number
  buildsStarted: number
  selected?: "rust" | "legacy"
  lastErrorCategory?: string
}

/** Discard Rust before lazily initializing the legacy index on a technical failure. */
export function nucleoLoadFallbackLayer(
  filepath: string,
  diagnostics: NucleoLoadDiagnostics,
  test?: { fault?: "build" | "search" },
) {
  return Layer.unwrap(
    Effect.sync(() => {
      diagnostics.attempts++
      const loaded = loadNucleoLibrary(filepath)
      if (loaded.ok) {
        diagnostics.selected = "rust"
        return Layer.effect(
          FileSystemSearch.Service,
          Effect.gen(function* () {
            const rust = yield* nucleoRuntime(loaded.library, {
              asyncBuild: true,
              fault: test?.fault,
              onBuildStart: () => diagnostics.buildsStarted++,
            })
            const legacy = Context.get(yield* Layer.build(FileSystemSearch.ripgrepLayer), FileSystemSearch.Service)
            return FileSystemSearch.Service.of({
              find: (input) => {
                if (diagnostics.selected === "legacy") return legacy.find(input)
                return rust.service.find(input).pipe(
                  Effect.catchCause((cause) => {
                    if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause)
                    return Effect.gen(function* () {
                      yield* rust.dispose
                      diagnostics.runtimeFailures++
                      diagnostics.selected = "legacy"
                      diagnostics.lastErrorCategory = "ERR_REDCODE_SEARCH_RUNTIME"
                      return yield* legacy.find(input)
                    })
                  }),
                )
              },
            })
          }),
        )
      }
      diagnostics.failures++
      diagnostics.selected = "legacy"
      diagnostics.lastErrorCategory = (loaded.error as Error & { code?: string }).code ?? loaded.error.name
      return FileSystemSearch.ripgrepLayer
    }),
  )
}
