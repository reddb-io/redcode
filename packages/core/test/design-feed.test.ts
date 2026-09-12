import { describe, expect, test } from "bun:test"
import { DateTime, Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { SessionMessage } from "@reddb-io/redcode-schema/session-message"
import { SessionEvent } from "../src/session/event"
import { EventV2 } from "../src/event"
import { DesignFeed } from "../src/design/feed"
import { DesignFeedback } from "../src/design/feedback"

const sessionID = Schema.decodeUnknownSync(SessionEvent.Prompted.data.fields.sessionID)("ses_feed")
const designID = Schema.decodeUnknownSync(Design.ID)("design_checkout")
const assistantMessageID = SessionMessage.ID.make("msg_assistant")
const timestamp = DateTime.makeUnsafe(1_700_000_000_000)
const durable = (seq: number) => ({ aggregateID: sessionID, seq, version: 1 })
const event = <D extends { readonly type: string }>(definition: D, seq: number, data: unknown) =>
  Schema.decodeUnknownSync(SessionEvent.Durable)({
    id: EventV2.ID.create(),
    type: definition.type,
    durable: durable(seq),
    data,
  })
const encoded = (data: Record<string, unknown>) => ({ ...data, timestamp: DateTime.toEpochMillis(timestamp) })
const all = (events: readonly SessionEvent.DurableEvent[]) =>
  events.reduce<{ state: DesignFeed.State; items: Design.FeedEvent[] }>(
    (result, item) => {
      const [state, items] = DesignFeed.reduce(result.state, item)
      return { state, items: [...result.items, ...items] }
    },
    { state: DesignFeed.initial, items: [] },
  ).items

describe("DesignFeed.reduce", () => {
  test("turns a review turn into user, tool, published and reply entries with the durable cursor", () => {
    const review = DesignFeedback.render(
      {
        id: SessionMessage.ID.make("msg_review"),
        revision: "rev_1",
        text: "Overall the flow works",
        items: [
          { target: "#title", text: "Bigger", label: 'h1 "Checkout"' },
          { target: "#submit", text: "Verb" },
        ],
        assets: [],
        snapshot: "",
        delivery: "steer",
        end: false,
      },
      { id: designID, storage: "/store", attachments: [] },
    )
    const items = all([
      event(
        SessionEvent.PromptAdmitted,
        3,
        encoded({ sessionID, messageID: "msg_review", prompt: { text: review }, delivery: "steer" }),
      ),
      event(
        SessionEvent.Tool.Called,
        4,
        encoded({
          sessionID,
          assistantMessageID,
          callID: "call_1",
          tool: "design_preview",
          input: { id: "design_checkout", name: "Second direction" },
          provider: { executed: false },
        }),
      ),
      event(
        SessionEvent.Tool.Success,
        5,
        encoded({
          sessionID,
          assistantMessageID,
          callID: "call_1",
          structured: { id: "rev_2", designID: "design_checkout", name: "Second direction", title: "Design" },
          content: [],
          provider: { executed: false },
        }),
      ),
      event(SessionEvent.Text.Started, 6, encoded({ sessionID, assistantMessageID, textID: "txt_1" })),
      event(
        SessionEvent.Text.Ended,
        7,
        encoded({ sessionID, assistantMessageID, textID: "txt_1", text: "Made the title larger.\n\nAnything else?" }),
      ),
      event(SessionEvent.AgentSwitched, 8, encoded({ sessionID, messageID: "msg_switch", agent: "plan" })),
    ])
    expect(items).toEqual([
      { type: "user", seq: 3, at: 1_700_000_000_000, id: "msg_review", text: "Overall the flow works · 2 notes" },
      {
        type: "tool",
        seq: 4,
        at: 1_700_000_000_000,
        id: "call_1",
        tool: "design_preview",
        status: "running",
        summary: "Second direction",
      },
      {
        type: "tool",
        seq: 5,
        at: 1_700_000_000_000,
        id: "call_1",
        tool: "design_preview",
        status: "done",
        summary: "Design",
      },
      {
        type: "published",
        seq: 5,
        at: 1_700_000_000_000,
        design: designID,
        revision: "rev_2",
        name: "Second direction",
      },
      { type: "reply", seq: 7, at: 1_700_000_000_000, id: "txt_1", text: "Made the title larger.\n\nAnything else?" },
      { type: "agent", seq: 8, at: 1_700_000_000_000, agent: "plan" },
    ])
    for (const item of items) expect(Schema.is(Design.FeedEvent)(item)).toBe(true)
  })

  test("attributes results to their call, reports failures and skips other tools' publications", () => {
    const items = all([
      event(
        SessionEvent.Tool.Called,
        1,
        encoded({
          sessionID,
          assistantMessageID,
          callID: "call_read",
          tool: "read",
          input: { filePath: "/tmp/index.html" },
          provider: { executed: false },
        }),
      ),
      event(
        SessionEvent.Tool.Success,
        2,
        encoded({
          sessionID,
          assistantMessageID,
          callID: "call_read",
          structured: { id: "rev_9", designID: "design_checkout", name: "Not a publication" },
          content: [],
          provider: { executed: false },
        }),
      ),
      event(
        SessionEvent.Tool.Failed,
        3,
        encoded({
          sessionID,
          assistantMessageID,
          callID: "call_lost",
          error: { type: "unknown", message: "Timed out" },
          provider: { executed: false },
        }),
      ),
      event(SessionEvent.Text.Ended, 4, encoded({ sessionID, assistantMessageID, textID: "txt_empty", text: "   " })),
    ])
    expect(items.map((item) => item.type)).toEqual(["tool", "tool", "tool"])
    expect(items[0]).toMatchObject({ tool: "read", status: "running", summary: "/tmp/index.html" })
    expect(items[1]).toMatchObject({ id: "call_read", tool: "read", status: "done" })
    expect(items[2]).toMatchObject({ id: "call_lost", tool: "", status: "failed", summary: "Timed out" })
  })

  test("bounds long text and describes plain prompts as written", () => {
    const long = "x".repeat(DesignFeed.LIMITS.text + 10)
    const items = all([
      event(
        SessionEvent.Prompted,
        1,
        encoded({ sessionID, messageID: "msg_plain", prompt: { text: "Make it pop" }, delivery: "steer" }),
      ),
      event(SessionEvent.Text.Ended, 2, encoded({ sessionID, assistantMessageID, textID: "txt_long", text: long })),
    ])
    expect(items[0]).toMatchObject({ type: "user", text: "Make it pop" })
    expect(items[1]).toMatchObject({ type: "reply", text: `${"x".repeat(DesignFeed.LIMITS.text)}…` })
  })
})
