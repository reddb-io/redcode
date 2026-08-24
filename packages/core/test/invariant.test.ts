import { describe, expect } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { RuntimeInvariant } from "@reddb-io/redcode-core/invariant"
import { testEffect } from "./lib/effect"

const it = testEffect(RuntimeInvariant.layer)

describe("RuntimeInvariant", () => {
  it.effect("owns checks by package and removes them with their scope", () =>
    Effect.gen(function* () {
      const invariants = yield* RuntimeInvariant.Service
      let runs = 0

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* invariants.register("@reddb-io/redcode-core/example", () => Effect.sync(() => runs++))
          expect(yield* invariants.list).toEqual(["@reddb-io/redcode-core/example"])
          expect(yield* invariants.run).toEqual([{ owner: "@reddb-io/redcode-core/example", ok: true }])
          expect(runs).toBe(1)
        }),
      )

      expect(yield* invariants.list).toEqual([])
      expect(yield* invariants.run).toEqual([])
      expect(runs).toBe(1)
    }),
  )

  it.effect("reports a failing owner by name and still fails the run", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const invariants = yield* RuntimeInvariant.Service
        yield* invariants.register("@reddb-io/redcode-core/healthy", () => Effect.void)
        yield* invariants.register("@reddb-io/redcode-core/broken", () =>
          Effect.sync(() => {
            throw new Error("plugin inventory drifted")
          }),
        )

        const exit = yield* Effect.exit(invariants.run)
        if (Exit.isSuccess(exit)) throw new Error("expected the broken invariant to fail the run")
        expect(Cause.pretty(exit.cause)).toContain("@reddb-io/redcode-core/broken")
        expect(Cause.pretty(exit.cause)).not.toContain("@reddb-io/redcode-core/healthy")

        const results = yield* invariants.results
        expect(results.find((result) => result.owner === "@reddb-io/redcode-core/healthy")).toEqual({
          owner: "@reddb-io/redcode-core/healthy",
          ok: true,
        })
        const broken = results.find((result) => result.owner === "@reddb-io/redcode-core/broken")
        expect(broken?.ok).toBe(false)
        expect(broken?.error).toContain("plugin inventory drifted")
      }),
    ),
  )
})
