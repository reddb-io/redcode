import { describe, expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { Design } from "@opencode/schema/design"
import { SessionEvent } from "@opencode/schema/session-event"
import { SessionMessage } from "@opencode/schema/session-message"
import { DesignFeed } from "@opencode/core/design/feed"
import { DesignFeedback } from "@opencode/core/design/feedback"
import { SessionSchema } from "@opencode/core/session/schema"

const sessionID = "ses_design_feed"
const assistantMessageID = "msg_feed_assistant"
const designID = Design.ID.make("design_checkout")
const at = 1_700_000_000_000

const event = (
  definition: { readonly type: string; readonly durable: { readonly version: number } },
  seq: number,
  data: Record<string, unknown>,
) =>
  Schema.decodeUnknownSync(SessionEvent.Durable)({
    id: `evt_feed_${seq}`,
    created: at,
    type: definition.type,
    durable: { aggregateID: sessionID, seq, version: definition.durable.version },
    data: { sessionID, ...data },
  })

const all = (events: readonly SessionEvent.DurableEvent[]) =>
  events.reduce<{ state: DesignFeed.State; items: Design.FeedEvent[] }>(
    (result, item) => {
      const [state, items] = DesignFeed.reduce(result.state, item)
      return { state, items: [...result.items, ...items] }
    },
    { state: DesignFeed.initial, items: [] },
  ).items

const tool = (seq: number, id: string, name: string, input: Record<string, unknown>) => [
  event(SessionEvent.Tool.Input.Started, seq, { assistantMessageID, id, name }),
  event(SessionEvent.Tool.Called, seq + 1, { assistantMessageID, id, input, executed: false }),
]

const success = (seq: number, id: string, metadata: Record<string, unknown>) =>
  event(SessionEvent.Tool.Success, seq, {
    assistantMessageID,
    id,
    content: [{ type: "text", text: "ok" }],
    metadata,
    executed: false,
  })

describe("DesignFeed.follow", () => {
  test("emits individual browser events and reconstructs call state before the reconnect cursor", async () => {
    const entries = await Effect.runPromise(
      DesignFeed.follow(
        {
          log: () =>
            Stream.fromIterable([
              ...tool(1, "call_preview", "design_preview", { name: "Updated screen" }),
              success(3, "call_preview", { designID, revision: "rev_updated" }),
              event(SessionEvent.Text.Ended, 4, { assistantMessageID, ordinal: 0, text: "Feedback applied" }),
            ]),
        },
        SessionSchema.ID.make(sessionID),
        2,
      ).pipe(Stream.runCollect),
    )
    expect(entries).toEqual([
      {
        type: "tool",
        seq: 3,
        at,
        id: "call_preview",
        tool: "design_preview",
        status: "done",
        summary: "Updated screen",
      },
      { type: "published", seq: 3, at, design: designID, revision: "rev_updated", name: "Updated screen" },
      { type: "reply", seq: 4, at, id: `${assistantMessageID}:0`, text: "Feedback applied" },
    ])
    expect(entries.every((entry) => Schema.is(Design.FeedEvent)(entry))).toBe(true)
  })
})

describe("DesignFeed.history", () => {
  test("reconstructs replies and published revisions without retained event payloads", () => {
    const user = Schema.decodeUnknownSync(SessionMessage.User)({
      id: "msg_history_user",
      type: "user",
      text: "Make the title larger",
      time: { created: at },
    })
    const assistant = Schema.decodeUnknownSync(SessionMessage.Assistant)({
      id: assistantMessageID,
      type: "assistant",
      agent: "design",
      model: { providerID: "smoke", id: "smoke-model" },
      time: { created: at },
      content: [
        {
          type: "tool",
          id: "call_history_preview",
          name: "design_preview",
          time: { created: at },
          state: {
            status: "completed",
            input: { name: "Updated screen" },
            content: [{ type: "text", text: "ok" }],
            metadata: { designID, revision: "rev_history" },
          },
        },
        { type: "text", text: "Feedback applied" },
      ],
    })
    const snapshot = DesignFeed.history([user, assistant], [])
    expect(snapshot.entries).toEqual([
      { seq: 0, at, type: "user", id: user.id, text: user.text, notes: 0 },
      {
        seq: 0,
        at,
        type: "tool",
        id: "call_history_preview",
        tool: "design_preview",
        status: "done",
        summary: "Updated screen",
      },
      { seq: 0, at, type: "published", design: designID, revision: "rev_history", name: "Updated screen" },
      { seq: 0, at, type: "reply", id: `${assistantMessageID}:1`, text: "Feedback applied" },
    ])
    expect(snapshot.state.users.get(user.id)).toEqual({ text: user.text, notes: 0 })
  })
})

describe("DesignFeed.reduce", () => {
  test("turns a review turn into user, tool, published, reply and agent entries at the durable cursor", () => {
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
      event(SessionEvent.InboxEnqueued, 1, {
        inboxID: "msg_review",
        item: { type: "user", payload: { text: review }, delivery: "steer" },
      }),
      event(SessionEvent.InboxDelivered, 2, { inboxID: "msg_review" }),
      event(SessionEvent.Execution.Started, 3, {}),
      ...tool(4, "call_preview", "design_preview", { id: "design_checkout", name: "Second direction" }),
      success(6, "call_preview", { designID: "design_checkout", revision: "rev_2" }),
      event(SessionEvent.Text.Ended, 7, {
        assistantMessageID,
        ordinal: 0,
        text: "Made the title larger.\n\nAnything else?",
      }),
      event(SessionEvent.AgentSelected, 8, { agent: "plan" }),
      event(SessionEvent.Execution.Succeeded, 9, {}),
    ])

    expect(items).toEqual([
      { type: "user", seq: 1, at, id: "msg_review", text: "Overall the flow works", notes: 2, pending: true },
      { type: "user", seq: 2, at, id: "msg_review", text: "Overall the flow works", notes: 2 },
      { type: "state", seq: 3, at, state: "working" },
      {
        type: "tool",
        seq: 5,
        at,
        id: "call_preview",
        tool: "design_preview",
        status: "running",
        summary: "Second direction",
      },
      {
        type: "tool",
        seq: 6,
        at,
        id: "call_preview",
        tool: "design_preview",
        status: "done",
        summary: "Second direction",
      },
      { type: "published", seq: 6, at, design: designID, revision: "rev_2", name: "Second direction" },
      {
        type: "reply",
        seq: 7,
        at,
        id: `${assistantMessageID}:0`,
        text: "Made the title larger.\n\nAnything else?",
      },
      { type: "agent", seq: 8, at, agent: "plan" },
      { type: "state", seq: 9, at, state: "idle" },
    ])
    items.forEach((item) => expect(Schema.is(Design.FeedEvent)(item)).toBe(true))
  })

  test("announces a round's verify verdicts once, with bounded labels and reasons", () => {
    const verified = [
      {
        design: "design_checkout",
        revision: "rev_2",
        round: 1,
        job: "render_verify",
        notes: [
          { feedback: "msg_review", index: 1, label: 'h1 "Checkout"', verdict: "pass", reason: "found" },
          {
            feedback: "msg_review",
            index: 2,
            label: "x".repeat(DesignFeed.LIMITS.summary + 5),
            verdict: "fail",
            reason: "element not found in rev_2",
          },
        ],
      },
    ]
    const items = all([
      ...tool(1, "call_jobs", "design_jobs", { id: "design_checkout" }),
      success(3, "call_jobs", { verified }),
      ...tool(4, "call_jobs_again", "design_jobs", { id: "design_checkout" }),
      success(6, "call_jobs_again", { verified }),
    ])

    expect(items.map((item) => item.type)).toEqual(["tool", "tool", "verified", "tool", "tool"])
    expect(items[2]).toEqual({
      type: "verified",
      seq: 3,
      at,
      design: designID,
      revision: "rev_2",
      round: 1,
      job: "render_verify",
      notes: [
        { feedback: "msg_review", index: 1, label: 'h1 "Checkout"', verdict: "pass", reason: "found" },
        {
          feedback: "msg_review",
          index: 2,
          label: `${"x".repeat(DesignFeed.LIMITS.summary)}…`,
          verdict: "fail",
          reason: "element not found in rev_2",
        },
      ],
    })
  })

  test("attributes results to their call, reports failures and skips other tools' publications", () => {
    const items = all([
      ...tool(1, "call_read", "read", { filePath: "/tmp/index.html" }),
      success(3, "call_read", { designID: "design_checkout", revision: "rev_9" }),
      event(SessionEvent.Tool.Failed, 4, {
        assistantMessageID,
        id: "call_lost",
        error: { type: "unknown", message: "Timed out" },
        executed: false,
      }),
      event(SessionEvent.Text.Ended, 5, { assistantMessageID, ordinal: 1, text: "   " }),
    ])

    expect(items.map((item) => item.type)).toEqual(["tool", "tool", "tool"])
    expect(items[0]).toMatchObject({ tool: "read", status: "running", summary: "/tmp/index.html" })
    expect(items[1]).toMatchObject({ id: "call_read", tool: "read", status: "done" })
    expect(items[2]).toMatchObject({ id: "call_lost", tool: "", status: "failed", summary: "Timed out" })
  })

  test("bounds long replies and describes plain prompts as written", () => {
    const long = "x".repeat(DesignFeed.LIMITS.text + 10)
    const items = all([
      event(SessionEvent.InboxEnqueued, 1, {
        inboxID: "msg_plain",
        item: { type: "user", payload: { text: "Make it pop" }, delivery: "queue" },
      }),
      event(SessionEvent.Text.Ended, 2, { assistantMessageID, ordinal: 0, text: long }),
    ])

    expect(items[0]).toMatchObject({ type: "user", text: "Make it pop", notes: 0, pending: true })
    expect(items[1]).toMatchObject({ type: "reply", text: `${"x".repeat(DesignFeed.LIMITS.text)}…` })
  })

  test("a delivery without its admission, and events outside the review vocabulary, add nothing", () => {
    expect(
      all([
        event(SessionEvent.InboxDelivered, 1, { inboxID: "msg_unknown" }),
        ...tool(2, "call_input", "read", {}).slice(0, 1),
      ]),
    ).toEqual([])
  })
})

describe("DesignFeed.summarize", () => {
  test("names a call by the first meaningful input field, bounded", () => {
    expect(DesignFeed.summarize({ command: "bun test", description: "Run tests" })).toBe("bun test")
    expect(DesignFeed.summarize({ name: "  ", path: "src/index.ts" })).toBe("src/index.ts")
    expect(DesignFeed.summarize({ count: 3 })).toBe("")
    expect(DesignFeed.summarize({ query: "y".repeat(DesignFeed.LIMITS.summary + 1) })).toBe(
      `${"y".repeat(DesignFeed.LIMITS.summary)}…`,
    )
  })
})
