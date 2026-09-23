import path from "node:path"
import { Effect, Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { check, object } from "./assertions"
import { request } from "./backend"
import { http } from "./dsl"
import type { Method, Scenario, ScenarioContext } from "./types"

// `design.host` served by this process: conversations on the legacy loop, the TUI's permission queue.
const root = "/api/design/session/{sessionID}"
const html = "<!doctype html><html><body><h1>Host checkout</h1></body></html>"
const Launch = Schema.Struct({
  url: Schema.String,
  outcome: Schema.Literals(["claimed", "connected", "pending"]),
  token: Schema.optional(Schema.Number),
})

export const designHostScenarios: Scenario[] = [
  http.protected
    .get("/api/design/list", "v2.designHost.list")
    .seeded(document)
    .at((ctx) => ({
      path: `/api/design/list?directory=${encodeURIComponent(String(ctx.directory))}`,
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      const conversations = Schema.decodeUnknownSync(Schema.Array(Design.Conversation))(body)
      const conversation = conversations.find((item) => item.sessionID === ctx.state.sessionID)
      check(
        conversation?.designs.some((design) => design.id === ctx.state.document.id) === true,
        `list should group the design under its conversation: ${JSON.stringify(conversations)}`,
      )
    }),
  http.protected
    .get(`${root}/open`, "v2.designHost.open")
    .seeded(session)
    .at((ctx) => ({ path: `${ctx.state.root}/open`, headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      object(body)
      check(
        typeof body.url === "string" && body.url.includes(`/design/session/${ctx.state.sessionID}/review`),
        "open should name the session's review page",
      )
      check(body.connected === 0, "no review page follows a fresh session")
    }),
  http.protected
    .post(`${root}/launch`, "v2.designHost.launch")
    .seeded(session)
    .at((ctx) => ({ path: `${ctx.state.root}/launch`, headers: ctx.headers(), body: { explicit: true } }))
    .json(200, (body, ctx) => {
      const launch = Schema.decodeUnknownSync(Launch)(body)
      check(launch.outcome === "claimed" && typeof launch.token === "number", "a fresh session should claim a launch")
      check(launch.url.includes(`/design/session/${ctx.state.sessionID}/review`), "the claim should name the review")
    }),
  http.protected
    .post(`${root}/launch/release`, "v2.designHost.release")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const current = yield* session(ctx)
        const launch = Schema.decodeUnknownSync(Launch)(
          yield* json(ctx, "POST", `${current.root}/launch`, { explicit: true }),
        )
        check(typeof launch.token === "number", "the seed should hold a claim")
        return { ...current, token: launch.token }
      }),
    )
    .at((ctx) => ({
      path: `${ctx.state.root}/launch/release`,
      headers: ctx.headers(),
      body: { token: ctx.state.token },
    }))
    .status(204, (ctx) =>
      Effect.gen(function* () {
        const again = Schema.decodeUnknownSync(Launch)(yield* json(ctx, "POST", `${ctx.state.root}/launch`, {}))
        check(again.outcome === "claimed", "a released claim should let the next launch claim again")
      }),
    ),
  http.protected
    .get(`${root}/feed`, "v2.designHost.feed")
    .seeded(session)
    .stream()
    .at((ctx) => ({ path: `${ctx.state.root}/feed`, headers: ctx.headers() }))
    .status(200, (_ctx, result) =>
      Effect.sync(() => {
        check(result.contentType.includes("text/event-stream"), "feed should stream Server-Sent Events")
        const entries = result.text
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => Schema.decodeUnknownSync(Design.FeedEvent)(JSON.parse(line.slice(5))))
        check(
          entries.some((entry) => entry.type === "agent"),
          `feed should open with the session's agent: ${result.text}`,
        )
      }),
    ),
  http.protected
    .post(`${root}/{designID}/feedback`, "v2.designHost.feedback")
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const current = yield* published(ctx)
        yield* ctx.llmText("Noted.")
        return {
          ...current,
          feedback: {
            id: `msg_${crypto.randomUUID()}`,
            revision: current.revision.id,
            text: "Make checkout clearer",
            items: [{ target: "h1", text: "Use a clearer heading", label: 'h1 "Host checkout"' }],
            assets: [],
            snapshot: "",
            delivery: "queue",
            end: false,
          },
        }
      }),
    )
    .at((ctx) => ({
      path: `${ctx.state.root}/${ctx.state.document.id}/feedback`,
      headers: ctx.headers(),
      body: ctx.state.feedback,
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        const receipt = Schema.decodeUnknownSync(Design.Receipt)(body)
        check(receipt.id === ctx.state.feedback.id, "the receipt should name the admitted feedback")
        // Admission promotes the feedback into the transcript and continues the conversation.
        yield* ctx.llmWait(1)
      }),
    ),
  http.protected
    .post(`${root}/{designID}/approve`, "v2.designHost.approve")
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const current = yield* published(ctx)
        yield* ctx.llmText("Planning.")
        return current
      }),
    )
    .at((ctx) => ({
      path: `${ctx.state.root}/${ctx.state.document.id}/approve`,
      headers: ctx.headers(),
      body: { revision: ctx.state.revision.id },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        object(body)
        check(
          body.revision === ctx.state.revision.id && typeof body.plan === "string",
          "approval should identify its revision and plan",
        )
        const content = yield* Effect.promise(() => Bun.file(String(body.plan)).text())
        check(content.includes(ctx.state.revision.id), "approval should write the handoff plan")
        // The handoff continues the conversation in Plan mode.
        yield* ctx.llmWait(1)
      }),
    ),
  http.protected
    .post(`${root}/permission`, "v2.designHost.permission")
    .seeded(session)
    .at((ctx) => {
      const file = path.join(String(ctx.directory), "index.html")
      return {
        path: `${ctx.state.root}/permission`,
        headers: ctx.headers(),
        body: { permission: "read", patterns: [file], always: [file], metadata: { path: file } },
      }
    })
    .json(200, (body) => {
      object(body)
      check(body.granted === true, "a project read allowed by the agent's rules should be granted without asking")
    }),
]

function json(ctx: ScenarioContext, method: Method, path: string, body?: unknown) {
  return request(method, { path, headers: ctx.headers(), body }).pipe(
    Effect.map((result) => {
      check(result.status === 200, `${method} ${path}: ${result.status} ${result.text}`)
      return result.body
    }),
  )
}

function session(ctx: ScenarioContext) {
  return Effect.gen(function* () {
    const info = yield* ctx.session({ title: "Design host" })
    return { sessionID: info.id, root: `/api/design/session/${info.id}` }
  })
}

/** A design on a legacy conversation, created through the review page's routes as the TUI does. */
function document(ctx: ScenarioContext) {
  return Effect.gen(function* () {
    const current = yield* session(ctx)
    const document = Schema.decodeUnknownSync(Design.Info)(
      yield* json(ctx, "POST", `/design/session/${current.sessionID}`, {
        name: "Host checkout",
        journey: "new",
        engine: "html",
        kind: "screen",
      }),
    )
    yield* Effect.promise(() => Bun.write(path.join(document.root, document.entry), html))
    return { ...current, document }
  })
}

function published(ctx: ScenarioContext) {
  return Effect.gen(function* () {
    const current = yield* document(ctx)
    const revision = Schema.decodeUnknownSync(Design.Revision)(
      yield* json(ctx, "POST", `/design/session/${current.sessionID}/${current.document.id}/revision`, {
        name: "First direction",
      }),
    )
    return { ...current, revision }
  })
}
