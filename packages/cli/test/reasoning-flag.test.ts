import { expect, test } from "bun:test"
import { Effect, Exit, Option } from "effect"
import { applyReasoningFlag } from "../src/reasoning-flag"

test("sets REDCODE_REASONING for a standalone server", () => {
  const env: Record<string, string | undefined> = {}
  Effect.runSync(applyReasoningFlag({ reasoning: Option.some("dual"), standalone: true }, env))
  expect(env.REDCODE_REASONING).toBe("dual")
})

test("leaves the environment alone without the flag", () => {
  const env: Record<string, string | undefined> = { REDCODE_REASONING: "single" }
  Effect.runSync(applyReasoningFlag({ reasoning: Option.none(), standalone: false }, env))
  expect(env.REDCODE_REASONING).toBe("single")
})

test("rejects the flag against the shared background service", () => {
  const env: Record<string, string | undefined> = {}
  const exit = Effect.runSyncExit(applyReasoningFlag({ reasoning: Option.some("single"), standalone: false }, env))
  expect(Exit.isFailure(exit)).toBe(true)
  expect(env.REDCODE_REASONING).toBeUndefined()
})
