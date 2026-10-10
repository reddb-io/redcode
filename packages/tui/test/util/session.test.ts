import { describe, expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"
import { formatContextUsage, retryStatus, sessionFamily } from "../../src/util/session"

// The context reading itself is tested with its shared module, `@opencode/util/context-usage`.

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

describe("util.session context usage format", () => {
  test("formats the usage against its window compactly", () => {
    expect(formatContextUsage(321_000, 279, 115_200)).toBe("321.0K / 115.2K (279%)")
    expect(formatContextUsage(14_100, 1, 1_000_000)).toBe("14.1K / 1.0M (1%)")
    expect(formatContextUsage(14_100, 1)).toBe("14.1K (1%)")
    expect(formatContextUsage(14_100)).toBe("14.1K")
  })
})
