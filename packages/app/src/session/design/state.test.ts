import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { designOrdinals } from "./state"

describe("designOrdinals", () => {
  test("reads the revision numbers the agent's publishes announced", () => {
    const message: SessionMessageInfo = {
      id: "a1",
      type: "assistant",
      agent: "design",
      model: { id: "model", providerID: "provider" },
      content: [
        {
          id: "call_1",
          type: "tool",
          name: "design_preview",
          time: { created: 1 },
          state: {
            status: "completed",
            input: {},
            content: [{ type: "text", text: "Published revision R2" }],
            metadata: { designID: "design_a", revision: "rev_2", ordinal: 2 },
          },
        },
      ],
      time: { created: 1 },
    }
    expect(designOrdinals([message]).get("rev_2")).toBe(2)
    expect(designOrdinals([message]).get("rev_1")).toBeUndefined()
  })
})
