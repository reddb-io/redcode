import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { DesignFeed } from "../../src/design/feed"
import { designFeed } from "@reddb-io/redcode-design/feed"

const sessionID = "ses_feed" as SessionV1.WithParts["info"]["sessionID"]
const designID = Schema.decodeUnknownSync(Design.ID)("design_checkout")
const message = (id: string, role: "user" | "assistant", parts: unknown[]) =>
  Schema.decodeUnknownSync(SessionV1.WithParts)({
    info:
      role === "user"
        ? {
            id,
            sessionID,
            role,
            time: { created: 1_700_000_000_000 },
            agent: "design",
            model: { providerID: "p", modelID: "m" },
          }
        : {
            id,
            sessionID,
            role,
            time: { created: 1_700_000_000_001 },
            parentID: "msg_user",
            modelID: "m",
            providerID: "p",
            mode: "design",
            agent: "design",
            path: { cwd: "/", root: "/" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
    parts: parts.map((part) => ({ sessionID, messageID: id, ...(part as object) })),
  })
const live = (type: string, data: unknown): EventV2.Payload => ({ id: EventV2.ID.create(), type, data: data as never })

describe("DesignFeed (legacy)", () => {
  test("replays the transcript: review notice, reply, tool state and the published revision", () => {
    const replayed = DesignFeed.replay([
      message("msg_review", "user", [
        {
          id: "prt_review_text",
          type: "text",
          text: "<design-review ...>",
          metadata: {
            designFeedback: {
              id: "design_checkout",
              feedback: "msg_review",
              revision: "rev_1",
              variant: null,
              ended: false,
              text: "Overall fine",
              notes: [{ label: 'h1 "Checkout"', text: "Bigger" }],
              attachments: [],
              snapshot: false,
            },
          },
        },
      ]),
      message("msg_reply", "assistant", [
        { id: "prt_step", type: "step-start" },
        {
          id: "prt_tool",
          type: "tool",
          callID: "call_1",
          tool: "design_preview",
          state: {
            status: "completed",
            input: { id: "design_checkout", name: "Second direction" },
            output: "Published rev_2",
            title: "Design",
            metadata: { id: "design_checkout", revision: "rev_2", url: "http://localhost/review" },
            time: { start: 1, end: 2 },
          },
        },
        { id: "prt_streaming", type: "text", text: "still typing", time: { start: 1 } },
        { id: "prt_done", type: "text", text: "Made the title larger.", time: { start: 1, end: 3 } },
      ]),
    ])
    expect(replayed.events).toEqual([
      { type: "user", seq: 0, at: 1_700_000_000_000, id: "msg_review", text: "Overall fine", notes: 1 },
      {
        type: "tool",
        seq: 0,
        at: 1_700_000_000_001,
        id: "call_1",
        tool: "design_preview",
        status: "done",
        summary: "Design",
      },
      {
        type: "published",
        seq: 0,
        at: 1_700_000_000_001,
        design: designID,
        revision: "rev_2",
        name: "Second direction",
      },
      { type: "reply", seq: 0, at: 1_700_000_000_001, id: "prt_done", text: "Made the title larger." },
    ])
    expect([...replayed.state.roles.entries()].map(([id, role]) => `${id}:${role}`)).toEqual([
      "msg_review:user",
      "msg_reply:assistant",
    ])
    for (const item of replayed.events) expect(Schema.is(Design.FeedEvent)(item)).toBe(true)
  })

  test("reduces live bus events by role: status, agent, running tools and finished assistant text only", () => {
    const assistant = message("msg_live", "assistant", []).info
    const steps = [
      live("session.status", { sessionID, status: { type: "busy" } }),
      live("message.updated", { sessionID, info: assistant }),
      live("message.part.updated", {
        sessionID,
        time: 1,
        part: {
          id: "prt_tool",
          sessionID,
          messageID: "msg_live",
          type: "tool",
          callID: "call_2",
          tool: "read",
          state: { status: "running", input: { filePath: "/tmp/a.html" }, time: { start: 1 } },
        },
      }),
      live("message.part.updated", {
        sessionID,
        time: 2,
        part: { id: "prt_text", sessionID, messageID: "msg_live", type: "text", text: "half", time: { start: 1 } },
      }),
      live("message.part.updated", {
        sessionID,
        time: 3,
        part: {
          id: "prt_text",
          sessionID,
          messageID: "msg_live",
          type: "text",
          text: "Done.",
          time: { start: 1, end: 3 },
        },
      }),
      live("message.part.updated", {
        sessionID,
        time: 4,
        part: {
          id: "prt_unknown",
          sessionID,
          messageID: "msg_unknown",
          type: "text",
          text: "?",
          time: { start: 1, end: 2 },
        },
      }),
      live("session.updated", {
        sessionID,
        info: {
          id: sessionID,
          slug: "feed",
          projectID: "proj_feed",
          directory: "/tmp/feed",
          title: "Feed",
          version: "test",
          agent: "plan",
          time: { created: 1, updated: 2 },
        },
      }),
      live("session.status", { sessionID, status: { type: "idle" } }),
    ]
    const items = steps.reduce<{ state: DesignFeed.State; items: Design.FeedEvent[] }>(
      (result, item) => {
        const [state, items] = DesignFeed.reduce(result.state, item)
        return { state, items: [...result.items, ...items] }
      },
      { state: DesignFeed.initial, items: [] },
    ).items
    expect(items.map((item) => ({ ...item, at: 0 }))).toEqual([
      { type: "state", seq: 0, at: 0, state: "working" },
      { type: "tool", seq: 0, at: 0, id: "call_2", tool: "read", status: "running", summary: "/tmp/a.html" },
      { type: "reply", seq: 0, at: 0, id: "prt_text", text: "Done." },
      { type: "agent", seq: 0, at: 0, agent: "plan" },
      { type: "state", seq: 0, at: 0, state: "idle" },
    ])
  })
})

describe("designFeed page module", () => {
  test("serializes standalone and follows Server-Sent Events with a resumable cursor", async () => {
    const source = designFeed.toString()
    expect(source).not.toContain("import(")
    const follow = new Function(`return (${source})`)() as typeof designFeed
    const controller = new AbortController()
    const urls: string[] = []
    const events: Design.FeedEvent[] = []
    const bodies = [
      'data: {"type":"state","seq":0,"at":1,"state":"working"}\n\n: heartbeat\n\ndata: {"type":"reply","seq":7,"at":1,"id":"txt_1","text":"Hello"}\n\n',
      'data: {"type":"state","seq":0,"at":2,"state":"idle"}\n\n',
    ]
    const done = Promise.withResolvers<void>()
    const unavailable: number[] = []
    follow(
      "http://feed.test/api/session/ses_1/design/feed",
      async (url) => {
        urls.push(url)
        const body = bodies.shift()
        if (body === undefined) {
          done.resolve()
          await new Promise(() => undefined)
        }
        return new Response(body, { headers: { "content-type": "text/event-stream" } })
      },
      controller.signal,
      (event) => events.push(event),
      () => unavailable.push(Date.now()),
    )
    await done.promise
    controller.abort()
    expect(events.map((event) => event.type)).toEqual(["state", "reply", "state"])
    expect(urls[0]).toEndWith("/feed?after=0")
    expect(urls[1]).toEndWith("/feed?after=7")
    expect(urls[2]).toEndWith("/feed?after=7")
    expect(unavailable).toEqual([])
  }, 10000)

  test("retries server and network failures but gives up on a client-side rejection", async () => {
    const follow = new Function(`return (${designFeed.toString()})`)() as typeof designFeed
    const controller = new AbortController()
    const statuses = [500, 429, 404, 200]
    const seen: number[] = []
    const unavailable = Promise.withResolvers<void>()
    follow(
      "http://feed.test/feed",
      async () => {
        const status = statuses.shift() ?? 200
        seen.push(status)
        return new Response(status === 200 ? "" : "nope", { status })
      },
      controller.signal,
      () => undefined,
      () => unavailable.resolve(),
    )
    await unavailable.promise
    await Bun.sleep(1500)
    controller.abort()
    // 500 and 429 are retried (1 s, then 2 s); 404 stops the loop before the 200 is ever requested.
    expect(seen).toEqual([500, 429, 404])
  }, 10000)
})
