import { describe, expect, test } from "bun:test"
import path from "node:path"
import { createHmac } from "node:crypto"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Reporter } from "../src/usage/reporter"
import { UsageReporterConfigTable, UsageReporterDeliveryTable } from "../src/usage/reporter.sql"
import { Database } from "../src/database/database"
import { EventSequenceTable, EventTable } from "../src/event/sql"
import { SessionMessageTable, SessionTable } from "../src/session/sql"
import { IntelligenceEvaluationTable } from "../src/intelligence/sql"
import { ProjectTable } from "../src/project/sql"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { SessionEvent } from "@opencode/schema/session-event"
import { Event } from "@opencode/schema/event"
import { Project } from "@opencode/schema/project"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { AbsolutePath } from "@opencode/schema/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { testEffect } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Reporter.node, Database.node]), {
    replacements: [Global.node.replace(tempGlobalLayer)],
  }),
)
const serve = (fetch: (request: Request) => Response | Promise<Response>) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })),
    (server) => Effect.sync(() => server.stop(true)),
  )
const seed = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const projectID = Project.ID.make("reporter-project")
  const sessionID = Session.ID.make("ses_reporter")
  const messageID = SessionMessage.ID.make("msg_reporter")
  const started = Date.now()
  yield* db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: AbsolutePath.make("/secret-repository"), sandboxes: [] })
  yield* db.insert(SessionTable).values({
    id: sessionID,
    project_id: projectID,
    slug: "secret-slug",
    title: "secret-title",
    directory: "/secret-repository",
    version: "test",
    time_created: started,
    time_updated: started + 10,
  })
  yield* db.insert(SessionMessageTable).values({
    id: messageID,
    session_id: sessionID,
    type: "assistant",
    seq: 1,
    data: {
      agent: Agent.ID.make("build"),
      model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
      content: [
        { type: "text", text: "secret-conversation" },
        {
          type: "tool",
          id: "call_tool",
          name: "bash",
          state: {
            status: "completed",
            input: { command: "secret-command", path: "/secret-tool-path" },
            content: [{ type: "text", text: "secret-tool-result" }],
          },
          time: { created: started + 4, ran: started + 4, completed: started + 8 },
        },
      ],
      time: { created: started, first: started + 2, streamed: started + 5, completed: started + 10 },
      tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 80, write: 20 } },
      cost: 0.01,
    },
  })
  yield* db.insert(EventSequenceTable).values({ aggregate_id: sessionID, seq: 1 })
  const eventID = Event.ID.create()
  yield* db.insert(EventTable).values({
    id: eventID,
    aggregate_id: sessionID,
    seq: 1,
    created: started + 10,
    type: Event.versionedType(SessionEvent.Step.Ended.type, SessionEvent.Step.Ended.durable.version),
    data: {
      sessionID,
      assistantMessageID: messageID,
      finish: "stop",
      cost: 0.01,
      tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 80, write: 20 } },
    },
  })
  yield* db.insert(IntelligenceEvaluationTable).values({
    id: "evaluation_test",
    session_id: sessionID,
    operation: "response_quality",
    evaluation_kind: "gate",
    fingerprint: "fingerprint",
    policy: "policy",
    decision: "accepted",
    model: "jev",
    evaluator: { transport: "red-router", baseURL: "https://secret-endpoint" },
    issues: ["secret-issue"],
    input_tokens: 20,
    output_tokens: 2,
    cost: 0.002,
    duration: 3,
    source_hash: "source",
    candidate_hash: "candidate",
    time_created: started,
  })
  return { sessionID, eventID }
})

describe("usage reporting", () => {
  it.live("marks zero-normalized native usage as unknown instead of confirmed free consumption", () =>
    Effect.gen(function* () {
      const reporter = yield* Reporter.Service
      const db = (yield* Database.Service).db
      const server = yield* serve(() => new Response(null, { status: 204 }))
      yield* reporter.configure({
        enabled: true,
        transport: "webhook",
        url: server.url.href,
        queue: "usage_events",
        secret: "reporter-test-secret",
      })
      const seeded = yield* seed
      yield* db
        .update(EventTable)
        .set({
          data: {
            sessionID: seeded.sessionID,
            assistantMessageID: "msg_reporter",
            finish: "stop",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        })
        .where(eq(EventTable.id, seeded.eventID))
      yield* reporter.collect()
      expect((yield* reporter.snapshot()).deliveries.find((item) => item.record.stage === "s2")?.record).toMatchObject({
        tokens: null,
        cost: null,
        usageBasis: "unknown",
        pricingBasis: "unknown",
        unknownUsageRecords: 1,
      })
    }),
  )
  it.live("projects native and S1 facts without content, signs delivery and deduplicates collection", () =>
    Effect.gen(function* () {
      const reporter = yield* Reporter.Service
      const requests: { body: string; id: string; signature: string; timestamp: string }[] = []
      const server = yield* serve(async (request) => {
        requests.push({
          body: await request.text(),
          id: request.headers.get("webhook-id")!,
          signature: request.headers.get("webhook-signature")!,
          timestamp: request.headers.get("webhook-timestamp")!,
        })
        return new Response(null, { status: 204 })
      })
      yield* reporter.configure({
        enabled: true,
        transport: "webhook",
        url: server.url.href,
        queue: "usage_events",
        secret: "reporter-test-secret",
      })
      yield* seed
      yield* reporter.collect()
      yield* reporter.collect()
      const snapshot = yield* reporter.snapshot()
      expect(snapshot.deliveries).toHaveLength(3)
      expect(snapshot.config.secretConfigured).toBe(true)
      const text = JSON.stringify(snapshot)
      for (const value of [
        "secret-conversation",
        "secret-repository",
        "secret-title",
        "secret-issue",
        "secret-endpoint",
        "reporter-test-secret",
        "secret-command",
        "secret-tool-path",
        "secret-tool-result",
      ])
        expect(text).not.toContain(value)
      expect(snapshot.deliveries.find((item) => item.record.stage === "s2")?.record).toMatchObject({
        tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 80, write: 20 } },
        firstOutputMs: 2,
        streamDurationMs: 5,
        durationMs: 10,
        messageSequence: 1,
        tools: { calls: 1, succeeded: 1, failed: 0, unfinished: 0, durationMs: 4 },
      })
      expect(snapshot.deliveries.find((item) => item.record.stage === "s1")?.record).toMatchObject({
        scope: "evaluation",
        tokens: { input: 20, output: 2, reasoning: null, cache: { read: null, write: null } },
        cost: 0.002,
      })
      expect(snapshot.deliveries.find((item) => item.record.stage === "session")?.record).toMatchObject({
        usageRecords: 2,
        tokens: { input: 120, output: 12, reasoning: null },
        cost: 0.012,
      })
      yield* reporter.dispatch()
      yield* reporter.dispatch()
      expect(requests).toHaveLength(3)
      for (const request of requests)
        expect(request.signature).toBe(
          `v1,${createHmac("sha256", "reporter-test-secret").update(`${request.id}.${request.timestamp}.${request.body}`).digest("base64")}`,
        )
      expect((yield* reporter.snapshot()).counts).toEqual({ pending: 0, delivered: 3, dead: 0 })
    }),
  )
  it.live("keeps IDs and payloads on retry, recovers expired leases and rejects delivered retries", () =>
    Effect.gen(function* () {
      const reporter = yield* Reporter.Service
      const db = (yield* Database.Service).db
      const received: string[] = []
      const server = yield* serve(async (request) => {
        received.push(await request.text())
        return new Response(null, { status: received.length === 1 ? 503 : 204 })
      })
      yield* reporter.configure({
        enabled: true,
        transport: "webhook",
        url: server.url.href,
        queue: "usage_events",
        secret: "reporter-test-secret",
      })
      yield* seed
      yield* reporter.collect()
      yield* reporter.dispatch()
      const pending = (yield* reporter.snapshot()).deliveries.find((item) => item.status === "pending")!
      yield* db
        .update(UsageReporterDeliveryTable)
        .set({ status: "sending", lease: "dead-process", lease_until: Date.now() - 1 })
        .where(eq(UsageReporterDeliveryTable.id, pending.id))
      yield* reporter.dispatch()
      expect(received.at(-1)).toBe(received[0])
      const result = yield* reporter.retry(pending.id).pipe(Effect.result)
      expect(result._tag).toBe("Failure")
      yield* reporter.collect()
      expect((yield* reporter.snapshot()).counts).toEqual({ pending: 0, delivered: 3, dead: 0 })
    }),
  )
  it.live("sends RedDB queue records with a stable dedup key and pauses collection", () =>
    Effect.gen(function* () {
      const reporter = yield* Reporter.Service
      const queries: string[] = []
      const server = yield* serve(async (request) => {
        expect(new URL(request.url).pathname).toBe("/query")
        const body = (await request.json()) as { query: string }
        queries.push(body.query)
        return Response.json({ ok: true })
      })
      yield* seed
      yield* reporter.collect()
      expect((yield* reporter.snapshot()).deliveries).toHaveLength(0)
      yield* reporter.configure({ enabled: true, transport: "reddb", url: server.url.href, queue: "usage_events" })
      // Explicit fixture boundary includes source data. Production configuration starts at save time.
      const db = (yield* Database.Service).db
      yield* db.update(UsageReporterConfigTable).set({ since: 0 })
      yield* reporter.collect()
      yield* reporter.dispatch()
      expect(queries).toHaveLength(3)
      expect(queries.every((query) => query.startsWith("QUEUE PUSH usage_events ") && query.includes(" DEDUP '"))).toBe(
        true,
      )
      yield* reporter.configure({ enabled: false, transport: "reddb", url: server.url.href, queue: "usage_events" })
      yield* reporter.dispatch()
      expect(queries).toHaveLength(3)
    }),
  )
  it.live("keeps each delivery bound to its original destination and strips extra payload fields", () =>
    Effect.gen(function* () {
      const reporter = yield* Reporter.Service
      const first: string[] = []
      const second: string[] = []
      const original = yield* serve(async (request) => {
        first.push(await request.text())
        return new Response(null, { status: 503 })
      })
      const replacement = yield* serve(async (request) => {
        second.push(await request.text())
        return new Response(null, { status: 204 })
      })
      yield* reporter.configure({
        enabled: true,
        transport: "webhook",
        url: original.url.href,
        queue: "usage_events",
        secret: "original-signing-secret",
      })
      yield* seed
      yield* reporter.collect()
      const snapshot = yield* reporter.snapshot()
      yield* reporter.configure({
        enabled: true,
        transport: "webhook",
        url: replacement.url.href,
        queue: "usage_events",
        secret: "replacement-signing-secret",
      })
      const input = {
        ...snapshot.deliveries[0].record,
        id: "reporter-extra",
        content: "secret-extra-content",
        metadata: { password: "secret-extra-password" },
      }
      yield* reporter.record(input)
      yield* reporter.dispatch()
      expect(first).toHaveLength(3)
      expect(second).toHaveLength(1)
      expect(second[0]).not.toContain("secret-extra")
      expect(second[0]).not.toContain("metadata")
      const pending = (yield* reporter.snapshot()).deliveries.find((item) => item.status === "pending")!
      yield* reporter.retry(pending.id, "current")
      yield* reporter.dispatch()
      expect(second).toHaveLength(2)
      expect(JSON.parse(second[1]).id).toBe(pending.id)
    }),
  )
})

test("restart preserves configuration, source identities and pending deliveries", async () => {
  await using directory = await tmpdir("redcode-reporter-restart-")
  const layer = () =>
    LayerNode.compile(LayerNode.group([Reporter.node, Database.node]), {
      replacements: [
        Global.node.replace(tempGlobalLayer),
        Database.node.replace(Database.configured({ path: path.join(directory.path, "reporter.sqlite") })),
      ],
    })
  const first = await Effect.runPromise(
    Effect.gen(function* () {
      const reporter = yield* Reporter.Service
      yield* reporter.configure({
        enabled: true,
        transport: "webhook",
        url: "https://reporting.example.test/events",
        queue: "usage_events",
        secret: "restart-signing-secret",
      })
      yield* seed
      yield* reporter.collect()
      return yield* reporter.snapshot()
    }).pipe(Effect.provide(layer()), Effect.scoped),
  )
  const second = await Effect.runPromise(
    Effect.gen(function* () {
      const reporter = yield* Reporter.Service
      yield* reporter.collect()
      return yield* reporter.snapshot()
    }).pipe(Effect.provide(layer()), Effect.scoped),
  )
  expect(second.config.instanceID).toBe(first.config.instanceID)
  expect(second.deliveries.map((item) => item.id).sort()).toEqual(first.deliveries.map((item) => item.id).sort())
  expect(second.counts).toEqual({ pending: 3, delivered: 0, dead: 0 })
})
