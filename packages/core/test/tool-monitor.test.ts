import { expect } from "bun:test"
import { DateTime, Effect, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Monitor as MonitorSchema } from "@reddb-io/redcode-schema/monitor"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Database } from "../src/database/database"
import { EventV2 } from "../src/event"
import { Location } from "../src/location"
import { LocationMutation } from "../src/location-mutation"
import { PermissionV2 } from "../src/permission"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { AbsolutePath } from "../src/schema"
import { SessionExecution } from "../src/session/execution"
import { SessionProjector } from "../src/session/projector"
import { SessionInput } from "../src/session/input"
import { SessionMessage } from "../src/session/message"
import { SessionSchema } from "../src/session/schema"
import { SessionWake } from "../src/session/wake"
import { SessionMessageTable, SessionTable } from "../src/session/sql"
import { MonitorTable } from "../src/monitor.sql"
import { MonitorTool } from "../src/tool/monitor"
import { ToolOutputStore } from "../src/tool-output-store"
import { ToolRegistry } from "../src/tool/registry"
import { ShellPolling } from "../src/tool/shell-polling"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { toolIdentity } from "./lib/tool"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node])))

const session = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const id = SessionSchema.ID.make(`ses_${crypto.randomUUID().replaceAll("-", "")}`)
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id,
      project_id: Project.ID.global,
      directory: "/project",
      slug: id,
      title: "Monitor",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  return id
})

const finished = (sessionID: SessionSchema.ID): MonitorSchema.Info => ({
  id: `monitor_${crypto.randomUUID()}`,
  sessionID,
  command: "probe: GET http://localhost:3000/health",
  workdir: "/project",
  options: { mode: "poll" },
  status: "succeeded",
  created: 1,
  updated: 2,
  attempts: 3,
  delivery: "pending",
  evidence: { exit: 0, output: "ok", truncated: false, matched: "status 200" },
})

/** Delivery with a recorded wake, so a test can tell "queued" from "queued and resumed". */
const delivery = (goalStatus?: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    const woken: string[] = []
    const deliver = MonitorTool.deliver({
      db,
      events,
      goal: () => Effect.succeed(goalStatus === undefined ? undefined : { status: goalStatus }),
      wake: (sessionID) => Effect.sync(() => void woken.push(sessionID)),
    })
    return { db, deliver, woken }
  })

it.effect("queues a finished monitor and resumes the session", () =>
  Effect.gen(function* () {
    const sessionID = yield* session
    const { db, deliver, woken } = yield* delivery()
    const info = finished(sessionID)

    expect(yield* deliver(sessionID)(info)).toBe(true)

    // Queued, never steered: a result must not land inside a turn the person started.
    expect(yield* SessionInput.hasPending(db, sessionID, "queue")).toBe(true)
    expect(yield* SessionInput.hasPending(db, sessionID, "steer")).toBe(false)
    expect(woken).toEqual([sessionID])
    const pending = yield* SessionInput.listPending(db, sessionID)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.prompt.text).toContain("A monitor finished")
    expect(pending[0]!.prompt.text).toContain("status 200")
  }),
)

it.effect("records the result but does not resume a session whose goal is parked", () =>
  Effect.gen(function* () {
    for (const status of ["paused", "blocked", "waiting"]) {
      const sessionID = yield* session
      const { db, deliver, woken } = yield* delivery(status)

      expect(yield* deliver(sessionID)(finished(sessionID))).toBe(true)

      // The result is never dropped: it waits in the inbox for whoever resumes the session.
      expect(yield* SessionInput.hasPending(db, sessionID, "queue")).toBe(true)
      expect(woken).toEqual([])
    }
  }),
)

it.effect("resumes a session whose goal is still active or already done", () =>
  Effect.gen(function* () {
    for (const status of ["active", "done"]) {
      const sessionID = yield* session
      const { deliver, woken } = yield* delivery(status)

      yield* deliver(sessionID)(finished(sessionID))

      expect(woken).toEqual([sessionID])
    }
  }),
)

it.effect("admits one input however often the same monitor is delivered", () =>
  Effect.gen(function* () {
    const sessionID = yield* session
    const { db, deliver } = yield* delivery()
    const info = finished(sessionID)

    yield* deliver(sessionID)(info)
    yield* deliver(sessionID)(info)

    const rows = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).all().pipe(Effect.orDie)
    expect(rows).toHaveLength(1)
    expect(yield* SessionInput.listPending(db, sessionID)).toHaveLength(1)
  }),
)

it.effect("offers the matching probe when a wait loop can be expressed as one", () =>
  Effect.sync(() => {
    const detection = ShellPolling.detect("until curl -f http://localhost:3000/health; do sleep 60; done")
    expect(detection?.probe).toBeDefined()
    const refusal = ShellPolling.probeRefusal(detection!)
    expect(refusal).toContain("Not run")
    expect(refusal).toContain("native monitor probe")
    const call = JSON.parse(refusal.split("\n").find((line) => line.startsWith("{"))!)
    expect(call).toMatchObject({ action: "probe", probe: { type: "http" } })
    // A shell monitor is never suggested here: this runtime has no shell monitor parameter.
    expect(refusal).not.toContain('"monitor":{"mode"')
  }),
)

// ---------------------------------------------------------------- composed layer

const permissionAllows = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
    rules: () => Effect.succeed([]),
  }),
)

const encodeMessage = Schema.encodeSync(SessionMessage.Message)

/** One projected message row, encoded the way the projector writes it. */
const messageRow = (sessionID: SessionSchema.ID, seq: number, message: SessionMessage.Message) => {
  const { id: _id, type, ...data } = encodeMessage(message)
  return {
    id: message.id,
    session_id: sessionID,
    type,
    seq,
    time_created: DateTime.toEpochMillis(message.time.created),
    data,
  } as unknown as typeof SessionMessageTable.$inferInsert
}

const userRow = (sessionID: SessionSchema.ID, seq: number, id: string, millis: number) =>
  messageRow(
    sessionID,
    seq,
    SessionMessage.User.make({
      id: SessionMessage.ID.make(id),
      type: "user",
      text: "Wait for the build",
      time: { created: DateTime.makeUnsafe(millis) },
    }),
  )

/** A turn started by a monitor result rather than by a person: the tool reads this as autonomous. */
const syntheticRow = (sessionID: SessionSchema.ID, seq: number, millis: number) =>
  messageRow(
    sessionID,
    seq,
    SessionMessage.Synthetic.make({
      id: SessionMessage.ID.make(`msg_synthetic_${crypto.randomUUID().replaceAll("-", "")}`),
      sessionID,
      type: "synthetic",
      text: "A monitor finished.",
      time: { created: DateTime.makeUnsafe(millis) },
    }),
  )

/**
 * The tool as the product builds it, not as a test wires it: the earlier tests inject a `wake` that
 * production never supplied, which is exactly why a missing one was invisible.
 */
const withMonitorTool = <A, E, R>(
  directory: string,
  body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>,
  executionLayer?: Layer.Layer<SessionExecution.Service>,
) =>
  Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, LocationMutation.node, MonitorTool.node]),
        [
          [
            Location.node,
            Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
          ],
          [PermissionV2.node, permissionAllows],
          [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
          ...(executionLayer ? [[SessionExecution.node, executionLayer] as const] : []),
        ],
      ),
    ),
  )

/**
 * A probe that settles on its first attempt finishes before the tool returns, and `Monitor.start`
 * then reports it inline as `observed` rather than delivering it. To exercise delivery the monitor
 * has to still be running when the tool returns, so this one waits for a process that never appears
 * and gives up shortly after.
 */
const probeCall = (sessionID: SessionSchema.ID, id = "call-probe") => ({
  sessionID,
  ...toolIdentity,
  call: {
    type: "tool-call" as const,
    id,
    name: "monitor",
    input: {
      action: "probe",
      probe: { type: "process", name: "redcode-test-process-that-does-not-exist", state: "running" },
      wait_ms: 0,
      interval_ms: 1_000,
      deadline_ms: 1_000,
    },
  },
})

it.live(
  "resumes the session through the bound execution service",
  () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
      Effect.gen(function* () {
        const sessionID = yield* session
        const woken: string[] = []
        // The runtime that owns execution publishes its wake here; `SessionExecutionLocal` does this
        // for real. A tool cannot depend on `SessionExecution`, so this is the seam it reads.
        yield* Effect.acquireRelease(
          Effect.sync(() => SessionWake.register((id) => Effect.sync(() => void woken.push(id)))),
          (remove) => Effect.sync(remove),
        )
        const execution = Layer.succeed(
          SessionExecution.Service,
          SessionExecution.Service.of({
            active: Effect.succeed(new Set()),
            resume: () => Effect.void,
            wake: (id) => Effect.sync(() => void woken.push(id)),
            interrupt: () => Effect.void,
          }),
        )

        yield* withMonitorTool(
          tmp.path,
          (registry) =>
            Effect.gen(function* () {
              const materialized = yield* registry.materialize()
              expect(materialized.definitions.map((tool) => tool.name)).toContain("monitor")
              yield* materialized.settle(probeCall(sessionID))
              // Delivery runs on a fiber forked into the monitor layer's scope, so it has to be
              // awaited while that layer is still open - the wait belongs inside this body.
              for (let spin = 0; woken.length === 0 && spin < 400; spin++) yield* Effect.sleep("20 millis")
            }),
          execution,
        )

        expect(woken).toEqual([sessionID])
        const { db } = yield* Database.Service
        expect(yield* SessionInput.hasPending(db, sessionID, "queue")).toBe(true)
      }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  15_000,
)

const materializeAndSettle = (registry: ToolRegistry.Interface, sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const materialized = yield* registry.materialize()
    yield* materialized.settle(probeCall(sessionID))
    const { db } = yield* Database.Service
    for (let spin = 0; spin < 2_000; spin++) {
      if (yield* SessionInput.hasPending(db, sessionID, "queue")) return
      yield* Effect.sleep("5 millis")
    }
  })

it.live(
  "still builds where nothing binds the execution service",
  () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const sessionID = yield* session
          // Nothing owns execution here, so nothing is registered and nothing resumes the session.
          SessionWake.reset()
          // The eval harness, embedded hosts and the httpapi scenarios compose the built-in tools
          // without a session runner; requiring `SessionExecution` there broke every one of them.
          yield* withMonitorTool(tmp.path, (registry) =>
            Effect.gen(function* () {
              yield* materializeAndSettle(registry, sessionID)
            }),
          )
          const { db } = yield* Database.Service
          // The result is still recorded; only the resume is missing.
          expect(yield* SessionInput.hasPending(db, sessionID, "queue")).toBe(true)
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  15_000,
)

/**
 * The continuation limit itself is the monitor runtime's, and `monitor.test.ts` already proves it
 * refuses a fourth autonomous monitor from one request. What was missing is the half this tool owns:
 * telling the runtime which request a monitor serves and whether a monitor result asked for it.
 * Without both, the limit can never engage and a session can start monitors from its own results
 * forever.
 */
it.live(
  "tells the runtime which request a monitor serves, and whether a monitor result asked for it",
  () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const sessionID = yield* session
          const { db } = yield* Database.Service
          const asked = `msg_user_${crypto.randomUUID().replaceAll("-", "")}`
          yield* db.insert(SessionMessageTable).values(userRow(sessionID, 1, asked, 10)).run().pipe(Effect.orDie)

          yield* withMonitorTool(tmp.path, (registry) =>
            Effect.gen(function* () {
              const materialized = yield* registry.materialize()
              yield* materialized.settle(probeCall(sessionID, "call-asked"))
            }),
          )
          const started = yield* db.select().from(MonitorTable).all().pipe(Effect.orDie)
          expect(started).toHaveLength(1)
          // A person asked, so this monitor is attributed to their message.
          expect(started[0]!.data.originMessageID).toBe(asked)

          // Now the latest thing said is a monitor result, so every further monitor is a
          // continuation of the same request. `autonomous` is not stored - it only gates the
          // runtime's limit - so the proof is the limit engaging, which it cannot do unless this
          // tool passes both the flag and the origin.
          yield* db.insert(SessionMessageTable).values(syntheticRow(sessionID, 2, 20)).run().pipe(Effect.orDie)
          const outcomes: string[] = []
          yield* withMonitorTool(tmp.path, (registry) =>
            Effect.gen(function* () {
              const materialized = yield* registry.materialize()
              for (const attempt of [1, 2, 3]) {
                const settled = yield* materialized
                  .settle(probeCall(sessionID, `call-continuation-${attempt}`))
                  .pipe(
                    Effect.catchDefect((defect) =>
                      Effect.succeed({ result: { type: "error" as const, value: String(defect) } }),
                    ),
                  )
                outcomes.push(String(settled.result.value))
              }
            }),
          )

          // Three monitors serve one request; the next continuation is refused.
          expect(outcomes.at(-1)).toContain("Monitor continuation limit reached")
          const all = yield* db.select().from(MonitorTable).all().pipe(Effect.orDie)
          expect(all.every((row) => row.data.originMessageID === asked)).toBe(true)
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  15_000,
)
