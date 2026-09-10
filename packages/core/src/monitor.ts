export * as Monitor from "./monitor"

import { and, eq } from "drizzle-orm"
import { Cause, Clock, Context, Effect, Layer, Scope, Semaphore } from "effect"
import { Monitor } from "@reddb-io/redcode-schema/monitor"
import { BackgroundJob } from "./background-job"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { MonitorTable } from "./monitor.sql"

export { Info, Evidence, Options } from "@reddb-io/redcode-schema/monitor"

export type Start = {
  sessionID: string
  originMessageID?: string
  autonomous?: boolean
  command: string
  workdir: string
  options: Monitor.Options
  run: Effect.Effect<Monitor.Evidence>
  notify: (info: Monitor.Info) => Effect.Effect<void | boolean>
}

export class Service extends Context.Service<
  Service,
  {
    start(input: Start): Effect.Effect<Monitor.Info>
    list(sessionID: string): Effect.Effect<Monitor.Info[]>
    get(sessionID: string, id: string): Effect.Effect<Monitor.Info | undefined>
    wait(sessionID: string, id: string, timeout: number): Effect.Effect<Monitor.Info | undefined>
    cancel(sessionID: string, id: string): Effect.Effect<Monitor.Info | undefined>
  }
>()("@redcode/Monitor") {}

export const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const jobs = yield* BackgroundJob.Service
  const scope = yield* Scope.Scope
  const lock = yield* Semaphore.make(1)
  const owner = crypto.randomUUID()

  const save = (info: Monitor.Info) =>
    database.db
      .update(MonitorTable)
      .set({ data: info })
      .where(and(eq(MonitorTable.id, info.id), eq(MonitorTable.owner, owner)))
      .run()
      .pipe(Effect.orDie)

  const recover = Effect.fn("Monitor.recover")(function* (row: typeof MonitorTable.$inferSelect) {
    if (row.data.status !== "running") return row.data
    if (row.owner === owner && (yield* jobs.get(row.id))?.status === "running") return row.data
    // A durable identity is not a durable process handle. Never repeat a command during recovery.
    return {
      ...row.data,
      status: "interrupted" as const,
      delivery: "suppressed" as const,
      error:
        "Execution ownership was lost. Inspect the external operation before explicitly starting a new observation.",
    }
  })

  const get = Effect.fn("Monitor.get")(function* (sessionID: string, id: string) {
    const row = yield* database.db
      .select()
      .from(MonitorTable)
      .where(and(eq(MonitorTable.session_id, sessionID), eq(MonitorTable.id, id)))
      .get()
      .pipe(Effect.orDie)
    return row ? yield* recover(row) : undefined
  })
  const list = Effect.fn("Monitor.list")(function* (sessionID: string) {
    const rows = yield* database.db
      .select()
      .from(MonitorTable)
      .where(eq(MonitorTable.session_id, sessionID))
      .all()
      .pipe(Effect.orDie)
    return yield* Effect.forEach(rows, recover)
  })
  const wait = Effect.fn("Monitor.wait")(function* (sessionID: string, id: string, timeout: number) {
    const info = yield* get(sessionID, id)
    if (info?.status !== "running") return info
    yield* jobs.wait({ id, timeout: Math.min(60_000, Math.max(0, timeout)) })
    return yield* get(sessionID, id)
  })
  const cancel = Effect.fn("Monitor.cancel")(function* (sessionID: string, id: string) {
    const info = yield* get(sessionID, id)
    if (info?.status !== "running") return info
    yield* jobs.cancel(id)
    return yield* get(sessionID, id)
  })

  const start = (input: Start) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const info = yield* lock.withPermit(
          Effect.gen(function* () {
            const previous = yield* list(input.sessionID)
            if (
              input.autonomous &&
              previous.filter((item) => item.originMessageID === input.originMessageID).length >= 3
            )
              return yield* Effect.die(
                new Error(
                  "Monitor continuation limit reached. Report the result and wait for new user input before starting another monitor.",
                ),
              )
            const active = previous.filter((item) => item.status === "running")
            if (active.length >= 8) return yield* Effect.die(new Error("At most 8 monitors may run per session."))
            const now = yield* Clock.currentTimeMillis
            const initial: Monitor.Info = {
              id: `monitor_${crypto.randomUUID()}`,
              sessionID: input.sessionID,
              command: input.command,
              workdir: input.workdir,
              options: input.options,
              status: "running",
              created: now,
              updated: now,
              attempts: 0,
              delivery: "pending",
              ...(input.originMessageID ? { originMessageID: input.originMessageID } : {}),
            }
            yield* database.db
              .insert(MonitorTable)
              .values({ id: initial.id, session_id: input.sessionID, owner, data: initial })
              .run()
              .pipe(Effect.orDie)
            let current = initial
            const run = Effect.gen(function* () {
              while (true) {
                const evidence = yield* input.run
                const now = yield* Clock.currentTimeMillis
                const failed =
                  input.options.failure_contains !== undefined &&
                  evidence.output.includes(input.options.failure_contains)
                const succeeded =
                  evidence.exit === 0 &&
                  (input.options.success_contains === undefined ||
                    evidence.output.includes(input.options.success_contains))
                current = {
                  ...current,
                  updated: now,
                  attempts: current.attempts + 1,
                  evidence,
                  status: failed
                    ? "failed"
                    : succeeded
                      ? "succeeded"
                      : input.options.mode === "once"
                        ? evidence.timedOut
                          ? "timed_out"
                          : "failed"
                        : "running",
                }
                yield* save(current)
                if (current.status !== "running") return
                yield* Effect.sleep(input.options.interval_ms ?? 10_000)
              }
            }).pipe(
              Effect.timeoutOption(input.options.deadline_ms ?? 3_600_000),
              Effect.flatMap((result) =>
                result._tag === "None"
                  ? Effect.sync(() => {
                      current = { ...current, status: "timed_out" }
                    })
                  : Effect.void,
              ),
              Effect.onExit((exit) =>
                Effect.gen(function* () {
                  if (exit._tag === "Failure")
                    current = {
                      ...current,
                      status: Cause.hasInterruptsOnly(exit.cause) ? "cancelled" : "failed",
                      delivery: Cause.hasInterruptsOnly(exit.cause) ? "suppressed" : "pending",
                      error: Cause.pretty(exit.cause).slice(0, 4_000),
                    }
                  current = { ...current, updated: yield* Clock.currentTimeMillis }
                  yield* save(current)
                }),
              ),
              Effect.as("Monitor finished"),
            )
            yield* jobs.start({
              id: initial.id,
              type: "monitor",
              title: input.command,
              metadata: { parentSessionId: input.sessionID, background: true },
              run: run.pipe(Effect.interruptible),
            })
            return initial
          }),
        )
        const result = yield* restore(jobs.wait({ id: info.id, timeout: input.options.wait_ms ?? 1_000 })).pipe(
          Effect.onInterrupt(() => jobs.cancel(info.id).pipe(Effect.asVoid)),
        )
        if (!result.timedOut) {
          const done = (yield* get(input.sessionID, info.id))!
          const observed = { ...done, delivery: "observed" as const }
          yield* save(observed)
          return observed
        }
        yield* Effect.gen(function* () {
          yield* jobs.wait({ id: info.id })
          const done = yield* get(input.sessionID, info.id)
          if (!done || done.status === "running" || done.status === "cancelled" || done.status === "interrupted") return
          yield* input.notify(done).pipe(
            Effect.matchCauseEffect({
              onSuccess: (delivered) => save({ ...done, delivery: delivered === false ? "suppressed" : "delivered" }),
              onFailure: (cause) =>
                save({
                  ...done,
                  delivery: "failed",
                  error: `Completion delivery failed: ${Cause.pretty(cause).slice(0, 2_000)}`,
                }),
            }),
          )
        }).pipe(Effect.interruptible, Effect.forkIn(scope))
        // Once yielded, only the asynchronous delivery owns the terminal result. Returning a
        // freshly completed snapshot here would deliver it both inline and via notification.
        return info
      }),
    )

  return Service.of({ start, list, get, wait, cancel })
})

export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Database.node, BackgroundJob.node],
})
