import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { EventTable } from "@opencode/core/event/sql"
import { MonitorRuntime } from "@opencode/core/monitor"
import { MonitorTable } from "@opencode/core/monitor/sql"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionGoal } from "@opencode/core/session/goal"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { Monitor } from "@opencode/schema/monitor"
import type { Event } from "@opencode/schema/event"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

// Keep actual durable Session admission; execution records wakes without starting a model.
const wakes = new Map<Session.ID, number>()
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.succeed(new Set()),
    isActive: () => Effect.succeed(false),
    resume: () => Effect.void,
    wake: (sessionID) => Effect.sync(() => wakes.set(sessionID, (wakes.get(sessionID) ?? 0) + 1)).pipe(Effect.asVoid),
    interrupt: () => Effect.succeed(false),
    awaitIdle: () => Effect.void,
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([MonitorRuntime.node, Session.node, Database.node, Bus.node, SessionGoal.node, SessionInbox.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(execution),
      Global.node.replace(tempGlobalLayer),
      offlineModels,
    ],
  ),
)

const harness = Effect.gen(function* () {
  const monitors = yield* MonitorRuntime.Service
  const sessions = yield* Session.Service
  const bus = yield* Bus.Service
  const database = yield* Database.Service
  const session = yield* sessions.create({ location: { directory: AbsolutePath.make("/monitor-test") } })
  const progress: Event.Data<typeof Monitor.Event.Progress>[] = []
  const finished = yield* Deferred.make<void>()
  const events: string[] = []
  yield* bus.listen((event) =>
    Effect.gen(function* () {
      if (Schema.is(Monitor.Event.Progress)(event) && event.data.sessionID === session.id) {
        progress.push(event.data)
        events.push(event.type)
      }
      if (Schema.is(Monitor.Event.Finished)(event) && event.data.sessionID === session.id) {
        events.push(event.type)
        yield* Deferred.succeed(finished, undefined)
      }
    }),
  )
  return { monitors, sessions, bus, database, sessionID: session.id, progress, finished, events }
})

const observation = (output: string, matched = false): Monitor.Evidence => ({
  exit: matched ? 0 : 1,
  output,
  truncated: false,
  probe: { matched, status: matched ? 200 : 202 },
})

const tick = (times: number) =>
  Effect.forEach(Array.from({ length: times }), () => TestClock.adjust("500 millis"), { discard: true })

describe("Monitor progress", () => {
  it.effect("coalesces saved native observations, bounds previews and never admits progress to the Session", () =>
    Effect.gen(function* () {
      const s = yield* harness
      const output = `prefix:${"x".repeat(Monitor.EVIDENCE_CHARS * 2)}:tail`
      const info = yield* s.monitors.start({
        sessionID: s.sessionID,
        command: "probe: GET https://example.com/status",
        workdir: "/monitor-test",
        options: { mode: "poll", wait_ms: 0, interval_ms: 1_000, deadline_ms: 60_000, jitter: false },
        probe: { type: "http", url: "https://example.com/status", headers: { authorization: "private-token" } },
        run: () => Effect.succeed(observation(output)),
      })
      yield* tick(60)
      expect(s.progress.length).toBeGreaterThan(0)
      expect(s.progress.length).toBeLessThanOrEqual(15)
      expect(
        s.progress.every((event, index) => index === 0 || event.attempts > s.progress[index - 1]!.attempts),
      ).toBeTrue()
      expect(s.progress.every((event) => event.evidence.output === output.slice(-Monitor.EVIDENCE_CHARS))).toBeTrue()
      expect(s.progress.every((event) => event.evidence.truncated)).toBeTrue()
      expect(JSON.stringify(s.progress)).not.toContain("private-token")
      const saved = yield* s.monitors.get(s.sessionID, info.id)
      expect(saved?.status).toBe("running")
      expect(saved?.attempts).toBeGreaterThan(s.progress.length)
      expect(saved?.evidence).toEqual(observation(output))
      expect(yield* s.sessions.inbox(s.sessionID)).toEqual([])
      expect(wakes.get(s.sessionID) ?? 0).toBe(0)
      expect(
        yield* s.database.db
          .select()
          .from(EventTable)
          .where(eq(EventTable.type, "monitor.progress"))
          .all()
          .pipe(Effect.orDie),
      ).toEqual([])
      yield* s.monitors.cancel(s.sessionID, info.id)
    }),
  )

  it.effect("delivers one terminal completion with original evidence and emits no progress after finishing", () =>
    Effect.gen(function* () {
      const s = yield* harness
      const state = { matched: false }
      const output = `complete:${"y".repeat(Monitor.EVIDENCE_CHARS * 2)}`
      const info = yield* s.monitors.start({
        sessionID: s.sessionID,
        originMessageID: "msg_original_request",
        command: "probe: file dist/report.json exists",
        workdir: "/monitor-test",
        options: { mode: "poll", wait_ms: 0, interval_ms: 1_000, deadline_ms: 60_000, jitter: false },
        run: () => Effect.succeed(observation(output, state.matched)),
      })
      yield* tick(8)
      expect(s.progress.length).toBeGreaterThan(0)
      expect(wakes.get(s.sessionID) ?? 0).toBe(0)
      state.matched = true
      yield* tick(2)
      yield* Deferred.await(s.finished)
      const done = yield* s.monitors.get(s.sessionID, info.id)
      expect(done).toMatchObject({
        status: "succeeded",
        delivery: "delivered",
        originMessageID: "msg_original_request",
      })
      expect(done?.evidence?.output).toBe(output)
      expect(done?.evidence?.truncated).toBeFalse()
      const inbox = yield* s.sessions.inbox(s.sessionID)
      expect(inbox).toHaveLength(1)
      expect(inbox[0]).toMatchObject({
        id: `msg_${info.id}`,
        type: "synthetic",
        payload: { metadata: { source: "monitor", monitorID: info.id } },
      })
      expect(wakes.get(s.sessionID)).toBe(1)
      const count = s.progress.length
      yield* tick(20)
      yield* s.monitors.list(s.sessionID)
      yield* s.monitors.get(s.sessionID, info.id)
      expect(s.progress).toHaveLength(count)
      expect(s.events.filter((event) => event === "monitor.finished")).toHaveLength(1)
      expect(s.events.at(-1)).toBe("monitor.finished")
      expect(yield* s.sessions.inbox(s.sessionID)).toHaveLength(1)
      expect(wakes.get(s.sessionID)).toBe(1)
    }),
  )

  it.effect("cancels its publisher and suppresses continuation", () =>
    Effect.gen(function* () {
      const s = yield* harness
      const info = yield* s.monitors.start({
        sessionID: s.sessionID,
        command: "probe: process vite is running",
        workdir: "/monitor-test",
        options: { mode: "poll", wait_ms: 0, interval_ms: 1_000, deadline_ms: 60_000, jitter: false },
        run: () => Effect.succeed(observation("not running yet")),
      })
      yield* tick(8)
      expect(s.progress.length).toBeGreaterThan(0)
      expect(yield* s.monitors.cancel(s.sessionID, info.id)).toMatchObject({
        status: "cancelled",
        delivery: "suppressed",
      })
      yield* Deferred.await(s.finished)
      const count = s.progress.length
      yield* tick(20)
      expect(s.progress).toHaveLength(count)
      expect(s.events.filter((event) => event === "monitor.finished")).toHaveLength(1)
      expect(yield* s.sessions.inbox(s.sessionID)).toEqual([])
      expect(wakes.get(s.sessionID) ?? 0).toBe(0)
    }),
  )

  it.effect("does not repeat an unchanged snapshot or show an attempt before it has saved", () =>
    Effect.gen(function* () {
      const s = yield* harness
      const next = yield* Deferred.make<Monitor.Evidence>()
      const state = { calls: 0 }
      const info = yield* s.monitors.start({
        sessionID: s.sessionID,
        command: "probe: GET https://example.com/status",
        workdir: "/monitor-test",
        options: { mode: "poll", wait_ms: 0, interval_ms: 1_000, deadline_ms: 60_000, jitter: false },
        run: () =>
          Effect.suspend(() => {
            state.calls++
            return state.calls === 1 ? Effect.succeed(observation("queued")) : Deferred.await(next)
          }),
      })
      yield* tick(8)
      expect(state.calls).toBe(2)
      expect(s.progress).toHaveLength(1)
      expect(s.progress[0]).toMatchObject({ attempts: 1, evidence: { output: "queued" } })
      yield* tick(8)
      expect(s.progress).toHaveLength(1)
      expect(yield* s.monitors.get(s.sessionID, info.id)).toMatchObject({ attempts: 1, status: "running" })
      yield* Deferred.succeed(next, observation("done", true))
      yield* Deferred.await(s.finished)
      expect(yield* s.monitors.get(s.sessionID, info.id)).toMatchObject({ attempts: 2, status: "succeeded" })
      expect(s.progress).toHaveLength(1)
    }),
  )

  for (const gating of ["paused", "new-input"] as const) {
    it.effect(`keeps progress and terminal admission from waking execution after ${gating}`, () =>
      Effect.gen(function* () {
        const s = yield* harness
        const state = { matched: false }
        const info = yield* s.monitors.start({
          sessionID: s.sessionID,
          command: "probe: GET https://example.com/ready",
          workdir: "/monitor-test",
          options: { mode: "poll", wait_ms: 0, interval_ms: 1_000, deadline_ms: 60_000, jitter: false },
          run: () => Effect.succeed(observation("waiting", state.matched)),
        })
        yield* tick(8)
        expect(s.progress.length).toBeGreaterThan(0)
        if (gating === "paused") {
          const goals = yield* SessionGoal.Service
          yield* goals.start(s.sessionID, { objective: "Wait until ready" })
          yield* goals.control(s.sessionID, { action: "pause" })
        }
        if (gating === "new-input") {
          const inbox = yield* SessionInbox.Service
          yield* inbox.admit({
            id: SessionMessage.ID.create(),
            sessionID: s.sessionID,
            item: {
              type: "user",
              payload: SessionInbox.UserPayload.make({ text: "Wait for my next instruction" }),
              delivery: "steer",
            },
          })
          yield* SessionInbox.promote(s.database.db, s.bus, s.sessionID, "input")
        }
        state.matched = true
        yield* tick(2)
        yield* Deferred.await(s.finished)
        expect(yield* s.monitors.get(s.sessionID, info.id)).toMatchObject({
          status: "succeeded",
          delivery: "delivered",
        })
        const inbox = yield* s.sessions.inbox(s.sessionID)
        expect(inbox).toHaveLength(1)
        expect(inbox[0]?.type).toBe("synthetic")
        if (inbox[0]?.type === "synthetic")
          expect(inbox[0].payload.text).toContain(
            gating === "paused" ? "The session goal is paused" : "newer instruction",
          )
        expect(wakes.get(s.sessionID) ?? 0).toBe(0)
      }),
    )
  }

  it.effect("recovers pending terminal delivery idempotently without reconstructing a progress publisher", () =>
    Effect.gen(function* () {
      const s = yield* harness
      const info: Monitor.Info = {
        id: "monitor_pending_recovery",
        sessionID: s.sessionID,
        command: "probe: file dist/report.json exists",
        workdir: "/monitor-test",
        options: { mode: "poll" },
        status: "succeeded",
        created: 0,
        updated: 1,
        attempts: 4,
        delivery: "pending",
        evidence: observation("report exists", true),
      }
      yield* s.database.db
        .insert(MonitorTable)
        .values({ id: info.id, session_id: s.sessionID, owner: "dead-runtime", data: info })
        .run()
        .pipe(Effect.orDie)
      expect(yield* s.monitors.get(s.sessionID, info.id)).toMatchObject({
        delivery: "delivered",
        evidence: info.evidence,
      })
      yield* s.monitors.list(s.sessionID)
      yield* tick(20)
      expect(s.progress).toEqual([])
      expect(yield* s.sessions.inbox(s.sessionID)).toHaveLength(1)
      expect(wakes.get(s.sessionID)).toBe(1)
    }),
  )
})
