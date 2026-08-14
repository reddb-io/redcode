import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { RuntimeInvariant } from "@opencode-ai/core/invariant"
import { testEffect } from "./lib/effect"

const it = testEffect(RuntimeInvariant.layer)

describe("RuntimeInvariant", () => {
  it.effect("owns checks by package and removes them with their scope", () =>
    Effect.gen(function* () {
      const invariants = yield* RuntimeInvariant.Service
      let runs = 0

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* invariants.register("@opencode-ai/core/example", () => Effect.sync(() => runs++))
          expect(yield* invariants.list).toEqual(["@opencode-ai/core/example"])
          yield* invariants.run
          expect(runs).toBe(1)
        }),
      )

      expect(yield* invariants.list).toEqual([])
      yield* invariants.run
      expect(runs).toBe(1)
    }),
  )
})
