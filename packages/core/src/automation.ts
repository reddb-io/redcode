export * as AutomationRuntime from "./automation.js"

import { Automation } from "@opencode/schema/automation"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { and, desc, eq, lte, notExists } from "drizzle-orm"
import { Cause, Context, DateTime, Effect, Layer, Option, Schema, Scope } from "effect"
import { Database } from "./database/database.js"
import { ExecutionOwner } from "./execution-owner.js"
import { Session } from "./session.js"
import { SessionGoal } from "./session/goal.js"
import { SessionInbox } from "./session/inbox.js"
import { SessionExecution } from "./session/execution.js"
import { AutomationRunTable, AutomationTable } from "./automation/sql.js"
import { AutomationSchedule } from "./automation/schedule.js"
import { AutomationCondition } from "./automation/condition.js"

export class NotFound extends Schema.TaggedError<NotFound>()("Automation.NotFound", { message: Schema.String }) {}
export class Invalid extends Schema.TaggedError<Invalid>()("Automation.Invalid", { message: Schema.String }) {}

function info(row: typeof AutomationTable.$inferSelect): Automation.Info {
  return {
    id: row.id,
    sessionID: row.session_id,
    title: row.title,
    prompt: row.prompt,
    schedule: row.schedule,
    ...(row.condition ? { condition: row.condition } : {}),
    enabled: row.enabled,
    nextAt: row.next_at,
    created: row.created_at,
    updated: row.updated_at,
  }
}
function runInfo(row: typeof AutomationRunTable.$inferSelect): Automation.Run {
  return {
    id: row.id,
    automationID: row.automation_id,
    inboxID: SessionMessage.ID.make(`msg_${row.id}`),
    trigger: row.trigger,
    scheduledAt: row.scheduled_at,
    created: row.created_at,
    updated: row.updated_at,
    status: row.status,
    ...(row.delivery_result ? { delivery: row.delivery_result } : {}),
    error: row.error,
  }
}

export const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const sessions = yield* Session.Service
  const goals = yield* SessionGoal.Service
  const inbox = yield* SessionInbox.Service
  const execution = yield* SessionExecution.Service
  const scope = yield* Scope.Scope
  const owner = yield* ExecutionOwner.make
  const active = new Set<Automation.RunID>()
  const find = (sessionID: SessionID, id: Automation.ID) =>
    database.db
      .select()
      .from(AutomationTable)
      .where(and(eq(AutomationTable.id, id), eq(AutomationTable.session_id, sessionID)))
      .get()
      .pipe(
        Effect.orDie,
        Effect.flatMap((row) =>
          row
            ? Effect.succeed(row)
            : Effect.fail(new NotFound({ message: "Automation not found in this conversation" })),
        ),
      )
  const findRun = (id: Automation.RunID) =>
    database.db.select().from(AutomationRunTable).where(eq(AutomationRunTable.id, id)).get().pipe(Effect.orDie)

  const deliver = Effect.fn("Automation.deliver")(function* (run: typeof AutomationRunTable.$inferSelect) {
    if (active.has(run.id)) return
    active.add(run.id)
    yield* Effect.gen(function* () {
      const task = yield* database.db
        .select()
        .from(AutomationTable)
        .where(eq(AutomationTable.id, run.automation_id))
        .get()
        .pipe(Effect.orDie)
      if (!task) return
      const decision = yield* Effect.gen(function* () {
        const session = yield* sessions.get(task.session_id)
        const goal = yield* goals.get(task.session_id)
        const reason = session.time.archived
          ? "Conversation is archived"
          : session.revert
            ? "Conversation has a staged revert"
            : goal?.status === "paused" || goal?.status === "blocked"
              ? `Goal is ${goal.status}`
              : undefined
        const inboxID = SessionMessage.ID.make(`msg_${run.id}`)
        const admitted = yield* inbox.reconcile({
          id: inboxID,
          sessionID: task.session_id,
          type: "user",
          delivery: "queue",
        })
        if (admitted) {
          // Recover the admission fact separately from deciding whether pending work may wake.
          if (!reason && (yield* inbox.list(task.session_id)).some((item) => item.id === inboxID))
            yield* execution.wake(task.session_id)
          return { status: "admitted" as const, delivery: "confirmed" as const, error: null, pause: false }
        }
        if (reason) return { status: "skipped" as const, delivery: "none" as const, error: reason, pause: true }
        if (run.trigger === "scheduled" && AutomationSchedule.missed(task.schedule, run.scheduled_at, Date.now()))
          return {
            status: "missed" as const,
            delivery: "none" as const,
            error: "Calendar occurrence missed by more than 10 minutes",
            pause: false,
          }
        if (task.condition) {
          let result = run.condition_result
          if (!result) {
            const observation = yield* Effect.tryPromise({
              try: () => AutomationCondition.observe(task.condition!),
              catch: (error) => (error instanceof Error ? error : new Error(String(error))),
            }).pipe(Effect.result)
            if (observation._tag === "Failure")
              return {
                status: "failed" as const,
                delivery: "none" as const,
                error: `Condition failed: ${observation.failure.message}`.slice(0, 1000),
                pause: true,
              }
            // Serialize transition state and the verdict: concurrent manual and scheduled runs
            // cannot both claim the same change, and recovery never repeats a recorded decision.
            result = yield* database.db
              .transaction((tx) =>
                Effect.gen(function* () {
                  const current = yield* tx.select().from(AutomationTable).where(eq(AutomationTable.id, task.id)).get()
                  const matched = observation.success.matched
                  const change = task.condition?.mode === "on_change"
                  const first = current?.condition_last === null || current === undefined
                  const verdict = {
                    matched: change ? !first && current!.condition_last === false && matched : matched,
                    summary:
                      change && first
                        ? `Initial observation: ${observation.success.summary}`
                        : observation.success.summary,
                  }
                  if (current && change)
                    yield* tx
                      .update(AutomationTable)
                      .set({ condition_last: matched, updated_at: Date.now() })
                      .where(eq(AutomationTable.id, task.id))
                      .run()
                  yield* tx
                    .update(AutomationRunTable)
                    .set({ condition_result: verdict, updated_at: Date.now() })
                    .where(and(eq(AutomationRunTable.id, run.id), eq(AutomationRunTable.status, "pending")))
                    .run()
                  return verdict
                }),
              )
              .pipe(Effect.orDie)
          }
          if (!result.matched)
            return {
              status: "skipped" as const,
              delivery: "none" as const,
              error: `Condition not met: ${result.summary}`.slice(0, 1000),
              pause: false,
            }
        }
        yield* sessions.prompt({
          sessionID: task.session_id,
          id: inboxID,
          text: task.prompt,
          delivery: "queue",
          metadata: { source: "automation", automationID: task.id, automationRunID: run.id },
        })
        return { status: "admitted" as const, delivery: "confirmed" as const, error: null, pause: false }
      }).pipe(
        Effect.catchTag("Hook.BlockedError", (error) =>
          Effect.succeed({
            status: "failed" as const,
            delivery: "none" as const,
            error: error.reason.slice(0, 1000),
            pause: true,
          }),
        ),
        Effect.exit,
      )
      // An interrupted dispatch retains its receipt for restart recovery with the same inbox ID.
      if (decision._tag === "Failure" && Cause.hasInterruptsOnly(decision.cause)) return
      const result =
        decision._tag === "Success"
          ? decision.value
          : {
              status: "failed" as const,
              // An unknown failure may have happened after the durable admission boundary.
              // Keep it terminal so restart recovery never repeats a possibly delivered prompt.
              delivery: "uncertain" as const,
              pause: true,
              error: Cause.prettyErrors(decision.cause)
                .map((error) => error.message || error.name)
                .join("\n")
                .slice(0, 1000),
            }
      yield* database.db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .update(AutomationRunTable)
              .set({
                status: result.status,
                delivery_result: result.delivery,
                error: result.error,
                updated_at: Date.now(),
              })
              .where(and(eq(AutomationRunTable.id, run.id), eq(AutomationRunTable.status, "pending")))
              .run()
            if (result.pause)
              yield* tx
                .update(AutomationTable)
                .set({ enabled: false, updated_at: Date.now() })
                .where(and(eq(AutomationTable.id, task.id), eq(AutomationTable.session_id, task.session_id)))
                .run()
          }),
        )
        .pipe(Effect.orDie)
    }).pipe(Effect.ensuring(Effect.sync(() => active.delete(run.id))))
  })

  const recover = Effect.fn("Automation.recover")(function* (candidate: typeof AutomationRunTable.$inferSelect) {
    if (candidate.owner.token !== owner.token && ExecutionOwner.alive(candidate.owner)) return
    return yield* database.db
      .transaction((tx) =>
        Effect.gen(function* () {
          const current = yield* tx
            .select()
            .from(AutomationRunTable)
            .where(eq(AutomationRunTable.id, candidate.id))
            .get()
          if (!current || current.status !== "pending" || current.owner.token !== candidate.owner.token) return
          yield* tx.update(AutomationRunTable).set({ owner }).where(eq(AutomationRunTable.id, current.id)).run()
          return { ...current, owner }
        }),
      )
      .pipe(Effect.orDie)
  })

  const claim = Effect.fn("Automation.claim")(function* (candidate: typeof AutomationTable.$inferSelect, now: number) {
    const id = Automation.RunID.create()
    return yield* database.db
      .transaction((tx) =>
        Effect.gen(function* () {
          const row = yield* tx.select().from(AutomationTable).where(eq(AutomationTable.id, candidate.id)).get()
          if (!row?.enabled || row.next_at === null || row.next_at > now) return
          const pending = yield* tx
            .select()
            .from(AutomationRunTable)
            .where(and(eq(AutomationRunTable.automation_id, row.id), eq(AutomationRunTable.status, "pending")))
            .get()
          if (pending) return
          const missed = AutomationSchedule.missed(row.schedule, row.next_at, now)
          const nextAt = AutomationSchedule.next(row.schedule, now)
          const run = {
            id,
            automation_id: row.id,
            trigger: "scheduled" as const,
            scheduled_at: row.next_at,
            status: missed ? ("missed" as const) : ("pending" as const),
            delivery_result: missed ? ("none" as const) : null,
            condition_result: null,
            owner,
            error: missed ? "Calendar occurrence missed by more than 10 minutes" : null,
            created_at: now,
            updated_at: now,
          }
          yield* tx.insert(AutomationRunTable).values(run).run()
          yield* tx
            .update(AutomationTable)
            .set({
              enabled: nextAt !== null,
              next_at: nextAt,
              updated_at: now,
            })
            .where(eq(AutomationTable.id, row.id))
            .run()
          return run
        }),
      )
      .pipe(Effect.orDie)
  })

  const tick = Effect.fn("Automation.tick")(function* () {
    const pending = yield* database.db
      .select()
      .from(AutomationRunTable)
      .where(eq(AutomationRunTable.status, "pending"))
      .orderBy(AutomationRunTable.created_at)
      .limit(100)
      .all()
      .pipe(Effect.orDie)
    yield* Effect.forEach(
      pending,
      (run) =>
        Effect.gen(function* () {
          if (active.size >= 4 || active.has(run.id)) return
          const claimed = yield* recover(run)
          if (claimed) yield* deliver(claimed).pipe(Effect.forkIn(scope, { startImmediately: true }))
        }),
      { discard: true },
    )
    const now = Date.now()
    const due = yield* database.db
      .select()
      .from(AutomationTable)
      .where(
        and(
          eq(AutomationTable.enabled, true),
          lte(AutomationTable.next_at, now),
          notExists(
            database.db
              .select()
              .from(AutomationRunTable)
              .where(
                and(eq(AutomationRunTable.automation_id, AutomationTable.id), eq(AutomationRunTable.status, "pending")),
              ),
          ),
        ),
      )
      .orderBy(AutomationTable.next_at)
      .limit(100)
      .all()
      .pipe(Effect.orDie)
    yield* Effect.forEach(
      due,
      (row) =>
        Effect.gen(function* () {
          if (active.size >= 4) return
          const run = yield* claim(row, now)
          if (run?.status === "pending") yield* deliver(run).pipe(Effect.forkIn(scope, { startImmediately: true }))
        }),
      { discard: true },
    )
  })

  yield* tick().pipe(
    Effect.catchCause((cause) => Effect.logWarning("Automation sweep failed", { cause })),
    Effect.andThen(Effect.sleep("5 seconds")),
    Effect.forever,
    Effect.forkScoped({ startImmediately: true }),
  )
  return {
    tick,
    list: (sessionID: SessionID) =>
      database.db
        .select()
        .from(AutomationTable)
        .where(eq(AutomationTable.session_id, sessionID))
        .orderBy(desc(AutomationTable.created_at))
        .all()
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows.map(info)),
        ),
    create: Effect.fn("Automation.create")(function* (sessionID: SessionID, input: Automation.Input) {
      const session = yield* sessions.get(sessionID)
      const existing = yield* database.db
        .select()
        .from(AutomationTable)
        .where(eq(AutomationTable.id, input.id))
        .get()
        .pipe(Effect.orDie)
      if (existing) {
        if (existing.session_id !== sessionID)
          return yield* new Invalid({ message: "Automation ID belongs to another conversation" })
        return info(existing)
      }
      if (session.time.archived || session.revert)
        return yield* new Invalid({
          message: "Reopen the conversation and clear its staged revert before scheduling work",
        })
      if (!input.title.trim() || !input.prompt.trim())
        return yield* new Invalid({ message: "Title and prompt must not be blank" })
      if (input.condition) {
        const problem = AutomationCondition.problem(input.condition)
        if (problem) return yield* new Invalid({ message: `Invalid condition: ${problem}` })
      }
      const now = Date.now()
      if (input.schedule.type === "once" && input.schedule.at <= now)
        return yield* new Invalid({ message: "Choose a future execution time" })
      if (input.schedule.type === "fixed_time" && Option.isNone(DateTime.zoneMakeNamed(input.schedule.timeZone)))
        return yield* new Invalid({ message: "Choose a named time zone supported by this execution host" })
      const nextAt = AutomationSchedule.next(input.schedule, now)
      if (nextAt === null) return yield* new Invalid({ message: "This schedule has no future occurrence" })
      yield* database.db
        .insert(AutomationTable)
        .values({
          id: input.id,
          session_id: sessionID,
          title: input.title.trim(),
          prompt: input.prompt,
          schedule: input.schedule,
          condition: input.condition ?? null,
          enabled: true,
          next_at: nextAt,
          created_at: now,
          updated_at: now,
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      return info(yield* find(sessionID, input.id))
    }),
    control: Effect.fn("Automation.control")(function* (sessionID: SessionID, id: Automation.ID, enabled: boolean) {
      const row = yield* find(sessionID, id)
      if (enabled && row.schedule.type === "once" && row.next_at === null)
        return yield* new Invalid({
          message: "This one-time schedule already fired; use Run now for an explicit retry",
        })
      const now = Date.now()
      yield* database.db
        .update(AutomationTable)
        .set({
          enabled,
          next_at: !enabled
            ? row.next_at
            : row.schedule.type === "once"
              ? Math.max(now, row.schedule.at)
              : AutomationSchedule.next(row.schedule, now),
          updated_at: now,
        })
        .where(and(eq(AutomationTable.id, id), eq(AutomationTable.session_id, sessionID)))
        .run()
        .pipe(Effect.orDie)
      return info(yield* find(sessionID, id))
    }),
    remove: Effect.fn("Automation.remove")(function* (sessionID: SessionID, id: Automation.ID) {
      yield* find(sessionID, id)
      yield* database.db
        .delete(AutomationTable)
        .where(and(eq(AutomationTable.id, id), eq(AutomationTable.session_id, sessionID)))
        .run()
        .pipe(Effect.orDie)
    }),
    history: Effect.fn("Automation.history")(function* (sessionID: SessionID, id: Automation.ID) {
      yield* find(sessionID, id)
      return yield* database.db
        .select()
        .from(AutomationRunTable)
        .where(eq(AutomationRunTable.automation_id, id))
        .orderBy(desc(AutomationRunTable.created_at))
        .limit(50)
        .all()
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows.map(runInfo)),
        )
    }),
    run: Effect.fn("Automation.run")(function* (sessionID: SessionID, id: Automation.ID, runID: Automation.RunID) {
      yield* find(sessionID, id)
      const now = Date.now()
      yield* database.db
        .insert(AutomationRunTable)
        .values({
          id: runID,
          automation_id: id,
          trigger: "manual",
          scheduled_at: now,
          status: "pending",
          delivery_result: null,
          owner,
          error: null,
          created_at: now,
          updated_at: now,
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      const existing = yield* findRun(runID)
      if (!existing || existing.automation_id !== id)
        return yield* new Invalid({ message: "Run ID belongs to another automation" })
      if (existing.status === "pending") {
        const claimed = yield* recover(existing)
        if (claimed) yield* deliver(claimed)
      }
      const result = yield* findRun(runID)
      if (!result) return yield* new NotFound({ message: "Automation was deleted during dispatch" })
      return runInfo(result)
    }),
  }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/Automation") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Database.node, Session.node, SessionGoal.node, SessionInbox.node, SessionExecution.node],
})
