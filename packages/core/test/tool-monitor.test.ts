import { expect } from "bun:test"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Monitor as MonitorSchema } from "@reddb-io/redcode-schema/monitor"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Database } from "../src/database/database"
import { EventV2 } from "../src/event"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { AbsolutePath } from "../src/schema"
import { SessionProjector } from "../src/session/projector"
import { SessionInput } from "../src/session/input"
import { SessionSchema } from "../src/session/schema"
import { SessionTable } from "../src/session/sql"
import { MonitorTool } from "../src/tool/monitor"
import { ShellPolling } from "../src/tool/shell-polling"
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
