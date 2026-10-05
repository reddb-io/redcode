import { describe, expect, test } from "bun:test"
import type { ModelInfo, SessionMessageInfo } from "@opencode/client"
import { Locale } from "../../src/util/locale"
import {
  contextUsage,
  formatContextUsage,
  lastAssistantWithUsage,
  retryStatus,
  sessionFamily,
} from "../../src/util/session"

const assistant = (id: string, input: number): SessionMessageInfo => ({
  id,
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [],
  tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0 },
})

describe("util.session", () => {
  test("flattens nested subagents from any session in the family", () => {
    const sessions = [
      { id: "root" },
      { id: "child-a", parentID: "root" },
      { id: "grandchild-a", parentID: "child-a" },
      { id: "great-grandchild-a", parentID: "grandchild-a" },
      { id: "grandchild-a2", parentID: "child-a" },
      { id: "child-b", parentID: "root" },
      { id: "grandchild-b", parentID: "child-b" },
    ]

    expect(sessionFamily(sessions, "great-grandchild-a")).toEqual([
      { session: sessions[1], prefix: "" },
      { session: sessions[2], prefix: "├─ " },
      { session: sessions[3], prefix: "│  └─ " },
      { session: sessions[4], prefix: "└─ " },
      { session: sessions[5], prefix: "" },
      { session: sessions[6], prefix: "└─ " },
    ])
  })

  test("tracks usage across undo and redo boundaries", () => {
    const messages = [assistant("msg_z", 10), assistant("msg_a", 30)]

    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(30)
    expect(lastAssistantWithUsage(messages, "msg_a")?.tokens.input).toBe(10)
    expect(lastAssistantWithUsage(messages, "msg_missing")).toBeUndefined()
    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(30)
  })

  test("resets usage at completed compaction until the next assistant reports it", () => {
    const compaction: SessionMessageInfo = {
      id: "msg_compaction",
      type: "compaction",
      status: "completed",
      reason: "manual",
      summary: "Current state",
      recent: "",
      time: { created: 0 },
    }
    const messages = [assistant("msg_before", 30), compaction]

    expect(lastAssistantWithUsage(messages)).toBeUndefined()

    messages.push(assistant("msg_after", 5))
    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(5)
  })

  test("names the model a retry waits for, and when a quota resets", () => {
    const at = Date.UTC(2026, 8, 29, 14, 5)
    expect(
      retryStatus({
        model: "Gemini 3.7 Flash",
        retry: { attempt: 2, at, error: { type: "provider.rate-limit", message: "Too many requests", status: 429 } },
        seconds: 42,
      }),
    ).toBe("Retrying in 42s · Gemini 3.7 Flash · attempt 2 · Too many requests")
    expect(
      retryStatus({
        model: "Gemini 3.7 Flash",
        retry: { attempt: 3, at, error: { type: "provider.rate-limit", message: "Usage limit reached", status: 429 } },
        seconds: 0,
      }),
    ).toBe(`Retry due · Gemini 3.7 Flash quota exhausted until ${Locale.time(at)} · attempt 3 · Usage limit reached`)
  })
})

describe("util.session context usage", () => {
  const messages = [assistant("msg_a", 321_000)]
  const model = (context: number) =>
    ({ providerID: "provider", id: "model", limit: { context, output: 8_192 } }) as unknown as ModelInfo

  test("reports the window the percentage is of", () => {
    expect(contextUsage(messages, [model(115_200)])).toEqual({ tokens: 321_000, limit: 115_200, percent: 279 })
    // A model entry without a window gives neither a percentage nor a window.
    expect(contextUsage(messages, [model(0)])).toEqual({ tokens: 321_000, limit: undefined, percent: undefined })
    expect(contextUsage(messages, [])).toEqual({ tokens: 321_000, limit: undefined, percent: undefined })
  })

  test("formats the usage against its window compactly", () => {
    expect(formatContextUsage(321_000, 279, 115_200)).toBe("321.0K / 115.2K (279%)")
    expect(formatContextUsage(14_100, 1, 1_000_000)).toBe("14.1K / 1.0M (1%)")
    expect(formatContextUsage(14_100, 1)).toBe("14.1K (1%)")
    expect(formatContextUsage(14_100)).toBe("14.1K")
  })
})
