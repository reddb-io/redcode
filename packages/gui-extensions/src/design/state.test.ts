import { describe, expect, test } from "bun:test"
import type { DesignNote, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { designActivity, designReview, designStatus, latestDesignPreview, openDesignReviewPane } from "./state"

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

const note = (round: number, index: number, status: DesignNote["status"]): DesignNote => ({
  feedback: `msg_${round}`,
  index,
  round,
  item: { target: `#n${index}`, text: `Note ${index}` },
  status,
  updated: 1,
})

describe("designReview", () => {
  test("summarizes the newest round, orders its notes by what needs attention and names the revision", () => {
    const review = designReview(
      {
        revision: "rev_3",
        ended: false,
        endRequested: true,
        rounds: [
          { number: 1, opened: 1, revision: "rev_1", feedback: ["msg_1"], published: "rev_2" },
          { number: 2, opened: 2, revision: "rev_2", feedback: ["msg_2"], published: "rev_3" },
        ],
        notes: [
          note(1, 1, "open"),
          note(2, 1, "resolved"),
          note(2, 2, "partial"),
          note(2, 3, "unresolved"),
          note(2, 4, "accepted"),
        ],
      },
      [{ id: "rev_3" }, { id: "rev_2" }, { id: "rev_1" }],
    )
    expect(review.round).toMatchObject({ number: 2, resolved: 1, partial: 1, unresolved: 1, accepted: 1, open: 0 })
    expect(review.notes.map((item) => item.status)).toEqual(["unresolved", "partial", "accepted", "resolved"])
    expect(review.earlier).toBe(1)
    expect(review.summary.revision).toEqual({ id: "rev_3", ordinal: 3 })
    expect(review.summary.endRequested).toBe(true)
  })

  test("has no round before the first review message", () => {
    const review = designReview({ revision: null, ended: false })
    expect(review.round).toBeUndefined()
    expect(review.notes).toEqual([])
    expect(review.earlier).toBe(0)
  })
})

describe("openDesignReviewPane", () => {
  const session = { id: "ses_a", server: { url: "http://127.0.0.1:4096" } }
  const pane = (attached: boolean) => {
    const opened: string[] = []
    return {
      opened,
      value: { attached: () => attached, open: (_session: typeof session, url: string) => void opened.push(url) },
    }
  }

  test("opens the simplified review at its stable address in an attached desktop pane, with no ticket", () => {
    const browser = pane(true)

    expect(openDesignReviewPane({ status: "active", value: browser.value, generation: 1 }, session)).toBe(true)
    expect(browser.opened).toEqual(["http://127.0.0.1:4096/design/session/ses_a/review?embed=1"])
  })

  test("leaves the review to a system browser while the pane cannot show it", () => {
    const browser = pane(false)

    expect(openDesignReviewPane({ status: "active", value: browser.value, generation: 1 }, session)).toBe(false)
    expect(openDesignReviewPane({ status: "pending" }, session)).toBe(false)
    expect(openDesignReviewPane({ status: "inactive", reason: "disabled" }, session)).toBe(false)
    expect(browser.opened).toEqual([])
  })
})
