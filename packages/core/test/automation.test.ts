import { afterEach, expect, setSystemTime, test } from "bun:test"
import { Automation } from "@opencode/schema/automation"
import { SessionMessage } from "@opencode/schema/session-message"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AutomationRuntime } from "@opencode/core/automation"
import { AutomationRunTable, AutomationTable } from "@opencode/core/automation/sql"
import { AutomationSchedule } from "@opencode/core/automation/schedule"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { ExecutionOwner } from "@opencode/core/execution-owner"
import { Instance } from "@opencode/core/instance/service"
import { HookRuntime } from "@opencode/core/hook"
import { ModelsDev } from "@opencode/core/models-dev"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionGoal } from "@opencode/core/session/goal"
import { Effect, Schema } from "effect"
import { eq } from "drizzle-orm"
import { tmpdir } from "./fixture/tmpdir"
import { hookCommand } from "./fixture/hook-command"

afterEach(() => setSystemTime())

function services(path = ":memory:", content?: string) {
  return AppNodeBuilder.build(
    LayerNode.group([AutomationRuntime.node, Session.node, Database.node, SessionGoal.node, Instance.node]),
    [
      Database.node.replace(Database.configured({ path })),
      Config.node.replace(Config.configured({ global: false, project: false, ...(content ? { content } : {}) })),
      ModelsDev.node.replace(ModelsDev.configured({ fetch: false })),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  )
}

test("automation contracts reject invalid identifiers and sub-minute intervals", () => {
  expect(Schema.decodeUnknownOption(Automation.ID)("auto")._tag).toBe("None")
  expect(Schema.decodeUnknownOption(Automation.RunID)("arun")._tag).toBe("None")
  expect(Schema.decodeUnknownOption(Automation.Schedule)({ type: "interval", everyMs: 59999 })._tag).toBe("None")
  expect(Schema.decodeUnknownSync(Automation.ID)(Automation.ID.create())).toStartWith("auto_")
  expect(Schema.decodeUnknownSync(Automation.RunID)(Automation.RunID.create())).toStartWith("arun_")
  const calendar = { type: "fixed_time", timeOfDay: "09:00", timeZone: "America/Sao_Paulo", weekdays: [1, 2, 3, 4, 5] }
  expect(Schema.decodeUnknownOption(Automation.Schedule)(calendar)._tag).toBe("Some")
  for (const value of [
    { ...calendar, timeOfDay: "24:00" },
    { ...calendar, timeZone: "+03:00" },
    { ...calendar, weekdays: [] },
    { ...calendar, weekdays: [0, 8] },
  ])
    expect(Schema.decodeUnknownOption(Automation.Schedule)(value)._tag).toBe("None")
})

test("calendar occurrences preserve local weekdays and DST gap and fold policy independently of the host zone", () => {
  for (const row of [
    {
      zone: "America/Sao_Paulo",
      time: "09:00",
      days: [1, 2, 3, 4, 5],
      from: "2026-10-30T13:00:00Z",
      next: "2026-11-02T12:00:00Z",
    },
    { zone: "America/New_York", time: "02:30", days: [7], from: "2026-03-08T05:00:00Z", next: "2026-03-08T07:30:00Z" },
    {
      zone: "America/New_York",
      time: "02:30",
      days: [1, 7],
      from: "2026-03-08T08:00:00Z",
      next: "2026-03-09T06:30:00Z",
    },
    {
      zone: "America/New_York",
      time: "01:30",
      days: [1, 7],
      from: "2026-11-01T04:00:00Z",
      next: "2026-11-01T05:30:00Z",
    },
    {
      zone: "America/New_York",
      time: "01:30",
      days: [1, 7],
      from: "2026-11-01T05:45:00Z",
      next: "2026-11-02T06:30:00Z",
    },
    {
      zone: "Australia/Lord_Howe",
      time: "02:15",
      days: [7],
      from: "2026-10-03T13:30:00Z",
      next: "2026-10-03T15:45:00Z",
    },
    { zone: "Asia/Kathmandu", time: "09:00", days: [1], from: "2026-10-26T00:00:00Z", next: "2026-10-26T03:15:00Z" },
    { zone: "UTC", time: "00:00", days: [5], from: "2026-12-31T23:59:59Z", next: "2027-01-01T00:00:00Z" },
    { zone: "UTC", time: "09:00", days: [1], from: "2026-10-26T09:00:00Z", next: "2026-11-02T09:00:00Z" },
  ]) {
    const schedule = Schema.decodeUnknownSync(Automation.Schedule)({
      type: "fixed_time",
      timeOfDay: row.time,
      timeZone: row.zone,
      weekdays: row.days,
    })
    expect(AutomationSchedule.next(schedule, Date.parse(row.from))).toBe(Date.parse(row.next))
  }
})

test("calendar lateness records missed occurrences without pausing or replaying them, and resumes at the next future time", async () => {
  await using tmp = await tmpdir()
  setSystemTime(new Date("2026-10-26T11:59:00Z"))
  await Effect.runPromise(
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const automations = yield* AutomationRuntime.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      const task = yield* automations.create(session.id, {
        id: Automation.ID.create(),
        title: "Morning check",
        prompt: "Inspect morning build",
        schedule: { type: "fixed_time", timeOfDay: "09:00", timeZone: "America/Sao_Paulo", weekdays: [1, 2, 3, 4, 5] },
      })
      expect(
        (yield* automations
          .create(session.id, {
            id: Automation.ID.create(),
            title: "Invalid zone",
            prompt: "Must not be scheduled",
            schedule: { type: "fixed_time", timeOfDay: "09:00", timeZone: "Not/AZone", weekdays: [1] },
          })
          .pipe(Effect.result))._tag,
      ).toBe("Failure")
      expect(task.nextAt).toBe(Date.parse("2026-10-26T12:00:00Z"))
      setSystemTime(new Date("2026-10-26T12:10:00Z"))
      yield* automations.tick()
      const admitted = yield* automations.history(session.id, task.id).pipe(
        Effect.tap(() => Effect.yieldNow),
        Effect.repeat({ until: (runs) => runs[0]?.status === "admitted", times: 1000 }),
      )
      expect(admitted).toHaveLength(1)
      expect(admitted[0].scheduledAt).toBe(task.nextAt!)
      expect(admitted[0].status).toBe("admitted")
      setSystemTime(new Date("2026-10-27T12:10:00.001Z"))
      yield* automations.tick()
      const missed = yield* automations.history(session.id, task.id)
      expect(missed).toHaveLength(2)
      expect(missed[0].status).toBe("missed")
      expect(yield* sessions.inbox(session.id)).toHaveLength(1)
      expect((yield* automations.list(session.id))[0]).toMatchObject({
        enabled: true,
        nextAt: Date.parse("2026-10-28T12:00:00Z"),
      })
      yield* automations.tick()
      expect(yield* automations.history(session.id, task.id)).toHaveLength(2)
      yield* automations.control(session.id, task.id, false)
      setSystemTime(new Date("2026-10-30T13:00:00Z"))
      expect((yield* automations.control(session.id, task.id, true)).nextAt).toBe(Date.parse("2026-11-02T12:00:00Z"))
      const manual = yield* automations.run(session.id, task.id, Automation.RunID.create())
      expect(manual.status).toBe("admitted")
      expect((yield* automations.list(session.id))[0].nextAt).toBe(Date.parse("2026-11-02T12:00:00Z"))
    }).pipe(Effect.provide(services()), Effect.scoped),
  )
})

test("manual automation admission is durable, queued and idempotent without changing the schedule", async () => {
  await using tmp = await tmpdir()
  await Effect.runPromise(
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const automations = yield* AutomationRuntime.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      const other = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      const input = {
        id: Automation.ID.create(),
        title: "Check build",
        prompt: "Inspect build results",
        schedule: { type: "interval" as const, everyMs: 60000 },
      }
      const task = yield* automations.create(session.id, input)
      expect(yield* automations.create(session.id, { ...input, prompt: "Ignored retry" })).toEqual(task)
      expect((yield* automations.create(other.id, input).pipe(Effect.result))._tag).toBe("Failure")
      expect((yield* automations.history(other.id, task.id).pipe(Effect.result))._tag).toBe("Failure")
      yield* automations.control(session.id, task.id, false)
      const id = Automation.RunID.create()
      const run = yield* automations.run(session.id, task.id, id)
      expect(run.status).toBe("admitted")
      expect(yield* automations.run(session.id, task.id, id)).toEqual(run)
      const inbox = yield* sessions.inbox(session.id)
      expect(inbox).toHaveLength(1)
      expect(inbox[0].id).toBe(run.inboxID)
      expect(inbox[0].delivery).toBe("queue")
      expect(yield* automations.history(session.id, task.id)).toHaveLength(1)
      const saved = (yield* automations.list(session.id))[0]
      expect(saved.enabled).toBe(false)
      expect(saved.nextAt).toBe(task.nextAt)
      yield* automations.remove(session.id, task.id)
      expect(yield* automations.list(session.id)).toEqual([])
      expect(yield* sessions.inbox(session.id)).toHaveLength(1)
    }).pipe(Effect.provide(services()), Effect.scoped),
  )
})

test("intervals coalesce missed occurrences, pause and resume without replaying a backlog", async () => {
  await using tmp = await tmpdir()
  await Effect.runPromise(
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const automations = yield* AutomationRuntime.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      const task = yield* automations.create(session.id, {
        id: Automation.ID.create(),
        title: "Observe",
        prompt: "Check progress",
        schedule: { type: "interval", everyMs: 60000 },
      })
      setSystemTime(new Date(task.created + 600000))
      yield* automations.tick()
      const runs = yield* automations.history(session.id, task.id).pipe(
        Effect.tap(() => Effect.yieldNow),
        Effect.repeat({ until: (rows) => rows[0]?.status === "admitted", times: 1000 }),
      )
      expect(runs).toHaveLength(1)
      expect(runs[0].scheduledAt).toBe(task.nextAt!)
      expect(runs[0].status).toBe("admitted")
      expect((yield* automations.list(session.id))[0].nextAt).toBe(Date.now() + 60000)
      yield* automations.tick()
      expect(yield* automations.history(session.id, task.id)).toHaveLength(1)
      yield* automations.control(session.id, task.id, false)
      setSystemTime(new Date(Date.now() + 600000))
      yield* automations.tick()
      expect(yield* automations.history(session.id, task.id)).toHaveLength(1)
      const resumed = yield* automations.control(session.id, task.id, true)
      expect(resumed.nextAt).toBe(Date.now() + 60000)
    }).pipe(Effect.provide(services()), Effect.scoped),
  )
})

test("one-time schedules fire once and paused goals suppress admission and pause the schedule", async () => {
  await using tmp = await tmpdir()
  await Effect.runPromise(
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const automations = yield* AutomationRuntime.Service
      const goals = yield* SessionGoal.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      const now = Date.now()
      const task = yield* automations.create(session.id, {
        id: Automation.ID.create(),
        title: "Once",
        prompt: "Inspect the result",
        schedule: { type: "once", at: now + 60000 },
      })
      setSystemTime(new Date(now + 60001))
      yield* automations.tick()
      const runs = yield* automations.history(session.id, task.id).pipe(
        Effect.tap(() => Effect.yieldNow),
        Effect.repeat({ until: (rows) => rows[0]?.status === "admitted", times: 1000 }),
      )
      expect(runs).toHaveLength(1)
      expect(runs[0].status).toBe("admitted")
      expect((yield* automations.list(session.id))[0].nextAt).toBeNull()
      expect((yield* automations.control(session.id, task.id, true).pipe(Effect.result))._tag).toBe("Failure")
      const blocked = yield* automations.create(session.id, {
        id: Automation.ID.create(),
        title: "Paused goal",
        prompt: "Should not run",
        schedule: { type: "interval", everyMs: 60000 },
      })
      yield* goals.start(session.id, { objective: "Keep this goal paused" })
      yield* goals.control(session.id, { action: "pause" })
      const run = yield* automations.run(session.id, blocked.id, Automation.RunID.create())
      expect(run.status).toBe("skipped")
      expect(run.error).toBe("Goal is paused")
      expect((yield* automations.list(session.id)).find((item) => item.id === blocked.id)?.enabled).toBe(false)
      expect(yield* sessions.inbox(session.id)).toHaveLength(1)
    }).pipe(Effect.provide(services()), Effect.scoped),
  )
})

test("recovery skips a live owner and later reuses its receipt and already admitted inbox identity", async () => {
  await using tmp = await tmpdir()
  const layer = () => services(`${tmp.path}/automation.sqlite`)
  const saved = await Effect.runPromise(
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const automations = yield* AutomationRuntime.Service
      const database = yield* Database.Service
      const owner = yield* ExecutionOwner.make
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      const task = yield* automations.create(session.id, {
        id: Automation.ID.create(),
        title: "Recover",
        prompt: "Inspect once",
        schedule: { type: "interval", everyMs: 60000 },
      })
      const id = Automation.RunID.create()
      const now = Date.now()
      yield* database.db
        .insert(AutomationRunTable)
        .values({
          id,
          automation_id: task.id,
          owner,
          trigger: "manual",
          scheduled_at: now,
          status: "pending",
          error: null,
          created_at: now,
          updated_at: now,
        })
        .run()
      yield* sessions.prompt({
        sessionID: session.id,
        id: SessionMessage.ID.make(`msg_${id}`),
        text: task.prompt,
        delivery: "queue",
        resume: false,
      })
      const goals = yield* SessionGoal.Service
      yield* goals.start(session.id, { objective: "Keep recovery paused" })
      yield* goals.control(session.id, { action: "pause" })
      yield* Effect.gen(function* () {
        const observer = yield* AutomationRuntime.Service
        yield* observer.tick()
        expect((yield* observer.history(session.id, task.id))[0].status).toBe("pending")
      }).pipe(Effect.provide(layer()), Effect.scoped)
      return { sessionID: session.id, automationID: task.id, runID: id }
    }).pipe(Effect.provide(layer()), Effect.scoped),
  )
  await Effect.runPromise(
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const automations = yield* AutomationRuntime.Service
      yield* automations.tick()
      const history = yield* automations.history(saved.sessionID, saved.automationID).pipe(
        Effect.tap(() => Effect.yieldNow),
        Effect.repeat({ until: (rows) => rows[0]?.status === "admitted", times: 1000 }),
      )
      expect(history).toHaveLength(1)
      expect(history[0].id).toBe(saved.runID)
      expect(history[0].status).toBe("admitted")
      expect(yield* sessions.inbox(saved.sessionID)).toHaveLength(1)
    }).pipe(Effect.provide(layer()), Effect.scoped),
  )
})

test("a project hook rejection records failed admission and pauses the automation", async () => {
  await using tmp = await tmpdir()
  const command = await hookCommand(
    tmp.path,
    "deny-automation",
    "process.stderr.write('Rejected by project hook');process.exit(2)",
  )
  await Effect.runPromise(
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const automations = yield* AutomationRuntime.Service
      const instances = yield* Instance.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      yield* HookRuntime.Service.use((hooks) => hooks.trust()).pipe(instances.provide(session))
      const task = yield* automations.create(session.id, {
        id: Automation.ID.create(),
        title: "Rejected",
        prompt: "Inspect the build",
        schedule: { type: "interval", everyMs: 60000 },
      })
      const run = yield* automations.run(session.id, task.id, Automation.RunID.create())
      expect(run.status).toBe("failed")
      expect(run.error).toContain("Rejected by project hook")
      expect((yield* automations.list(session.id))[0].enabled).toBe(false)
      expect(yield* sessions.inbox(session.id)).toHaveLength(0)
    }).pipe(
      Effect.provide(
        services(
          ":memory:",
          JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command }] }] } }),
        ),
      ),
      Effect.scoped,
    ),
  )
})

test("calendar recovery expires unadmitted work while preserving an existing admission fact", async () => {
  await using tmp = await tmpdir()
  for (const admitted of [false, true]) {
    setSystemTime(new Date("2026-10-26T08:00:00Z"))
    const layer = () => services(`${tmp.path}/${admitted ? "admitted" : "pending"}.sqlite`)
    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const automations = yield* AutomationRuntime.Service
        const database = yield* Database.Service
        const owner = yield* ExecutionOwner.make
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
        const task = yield* automations.create(session.id, {
          id: Automation.ID.create(),
          title: "Calendar recovery",
          prompt: "Inspect build",
          schedule: { type: "fixed_time", timeOfDay: "09:00", timeZone: "UTC", weekdays: [1] },
        })
        setSystemTime(new Date("2026-10-26T09:00:00Z"))
        const id = Automation.RunID.create()
        yield* database.db
          .insert(AutomationRunTable)
          .values({
            id,
            automation_id: task.id,
            trigger: "scheduled",
            scheduled_at: Date.now(),
            status: "pending",
            owner,
            error: null,
            created_at: Date.now(),
            updated_at: Date.now(),
          })
          .run()
        yield* database.db
          .update(AutomationTable)
          .set({ next_at: Date.parse("2026-11-02T09:00:00Z") })
          .where(eq(AutomationTable.id, task.id))
          .run()
        if (admitted)
          yield* sessions.prompt({
            sessionID: session.id,
            id: SessionMessage.ID.make(`msg_${id}`),
            text: task.prompt,
            delivery: "queue",
            resume: false,
          })
        return { sessionID: session.id, automationID: task.id, runID: id }
      }).pipe(Effect.provide(layer()), Effect.scoped),
    )
    setSystemTime(new Date("2026-10-26T09:11:00Z"))
    await Effect.runPromise(
      Effect.gen(function* () {
        const automations = yield* AutomationRuntime.Service
        const sessions = yield* Session.Service
        yield* automations.tick()
        const history = yield* automations.history(saved.sessionID, saved.automationID).pipe(
          Effect.tap(() => Effect.yieldNow),
          Effect.repeat({ until: (runs) => !!runs[0] && runs[0].status !== "pending", times: 1000 }),
        )
        expect(history).toHaveLength(1)
        expect(history[0]).toMatchObject({ id: saved.runID, status: admitted ? "admitted" : "missed" })
        expect(yield* sessions.inbox(saved.sessionID)).toHaveLength(admitted ? 1 : 0)
        expect((yield* automations.list(saved.sessionID))[0]).toMatchObject({
          enabled: true,
          nextAt: Date.parse("2026-11-02T09:00:00Z"),
        })
      }).pipe(Effect.provide(layer()), Effect.scoped),
    )
  }
})
