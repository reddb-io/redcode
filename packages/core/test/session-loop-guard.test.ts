import { describe, expect, test } from "bun:test"
import { LoopGuard } from "@reddb-io/redcode-core/session/loop-guard"

describe("LoopGuard argument keying", () => {
  test("treats the same arguments in a different key order as the same call", () => {
    const call = (input: Record<string, unknown>): LoopGuard.Part => ({
      type: "tool",
      tool: "read",
      state: { status: "completed", input, output: "same" },
    })
    const parts = [call({ path: "a.ts", limit: 10 }), call({ limit: 10, path: "a.ts" })]
    expect(LoopGuard.streak(parts, { tool: "read", input: { path: "a.ts", limit: 10 } })).toBe(2)
    expect(LoopGuard.repeats(parts, { tool: "read", input: { limit: 10, path: "a.ts" } })).toBe(2)
    expect(LoopGuard.streak(parts, { tool: "read", input: { path: "b.ts", limit: 10 } })).toBe(0)
  })
})
