import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { designActivity, designStatus, latestDesignPreview } from "./state"

const assistant = (id: string, tools: { id: string; name: string; done: boolean }[]): SessionMessageInfo => ({
  id,
  type: "assistant",
  agent: "design",
  model: { id: "model", providerID: "provider" },
  content: tools.map(
    (tool): SessionMessageAssistantTool => ({
      id: tool.id,
      type: "tool",
      name: tool.name,
      time: { created: 1 },
      state: tool.done
        ? { status: "completed", input: {}, content: [{ type: "text", text: "ok" }] }
        : { status: "running", input: {}, metadata: {} },
    }),
  ),
  time: { created: 1 },
})

describe("designStatus", () => {
  test("uses the terminal's buckets", () => {
    expect(designStatus({ revision: null, approvedRevision: null, ended: false })).toBe("draft")
    expect(designStatus({ revision: "rev_1", approvedRevision: null, ended: false })).toBe("review")
    expect(designStatus({ revision: "rev_2", approvedRevision: "rev_1", ended: false })).toBe("review")
    expect(designStatus({ revision: "rev_2", approvedRevision: "rev_2", ended: false })).toBe("approved")
    expect(designStatus({ revision: "rev_2", approvedRevision: "rev_2", ended: true })).toBe("closed")
  })
})

describe("latestDesignPreview", () => {
  test("returns the newest finished preview", () => {
    const messages = [
      assistant("a1", [{ id: "call_1", name: "design_preview", done: true }]),
      assistant("a2", [
        { id: "call_2", name: "design_preview", done: true },
        { id: "call_3", name: "design_preview", done: false },
        { id: "call_4", name: "read", done: true },
      ]),
    ]
    expect(latestDesignPreview(messages)).toBe("call_2")
    expect(latestDesignPreview([])).toBeUndefined()
  })
})

describe("designActivity", () => {
  test("counts finished Design tools and Design prompts", () => {
    const messages: SessionMessageInfo[] = [
      assistant("a1", [
        { id: "call_1", name: "design_document", done: true },
        { id: "call_2", name: "design_preview", done: false },
        { id: "call_3", name: "bash", done: true },
      ]),
      { id: "u1", type: "user", text: "feedback", metadata: { source: "design.feedback" }, time: { created: 2 } },
      { id: "s1", type: "synthetic", text: "approved", metadata: { source: "design.approval" }, time: { created: 3 } },
      { id: "u2", type: "user", text: "hello", time: { created: 4 } },
    ]
    expect(designActivity(messages)).toBe(3)
  })
})
