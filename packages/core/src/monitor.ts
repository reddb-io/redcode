export * as Monitor from "./monitor"

import { readFileSync } from "node:fs"
import { and, eq, sql } from "drizzle-orm"
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
  /**
   * One observation. Call `track` with the pid of a detached process group it spawns, so a runtime
   * that restarts after a crash can reap that group instead of leaving it running unowned.
   */
  run: (track: (pid: number) => Effect.Effect<void>) => Effect.Effect<Monitor.Evidence>
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

/**
 * A process as `/proc` identifies it: its start time (clock ticks since boot) and its process group.
 * Linux only. Elsewhere nothing cheap tells a live process from an unrelated one that reused its pid,
 * so nothing is recorded there and nothing is ever killed.
 */
export function processInfo(pid: number): { started: string; group: number } | undefined {
  if (process.platform !== "linux" || !Number.isInteger(pid) || pid <= 0) return undefined
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    // The command name is parenthesised and may contain spaces; fields are counted after it.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
    const started = fields[19]
    const group = Number(fields[2])
    return started ? { started, group } : undefined
  } catch {
    return undefined
  }
}

/** Owners of the monitor runtimes alive in this process. */
const live = new Set<string>()
const self = `${process.pid}:${processInfo(process.pid)?.started ?? ""}`

/**
 * Whether the runtime that owns a row may still be running its monitors. Owners are
 * `pid:start-time:uuid`: another process is alive while that pid still has that start time (or,
 * without `/proc`, while the pid exists); this process knows its own runtimes directly.
 */
export function ownerAlive(owner: string) {
  if (live.has(owner)) return true
  const [pid, started, id] = owner.split(":")
  if (!pid || started === undefined || !id) return false
  if (`${pid}:${started}` === self) return false
  if (process.platform === "linux") return started !== "" && processInfo(Number(pid))?.started === started
  try {
    process.kill(Number(pid), 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/** Kill an interrupted monitor's detached process group, only when it is provably the process recorded. */
export function reap(recorded: Monitor.Process | undefined) {
  if (!recorded) return false
  const current = processInfo(recorded.pid)
  if (!current || current.started !== recorded.started || current.group !== recorded.pid) return false
  try {
    process.kill(-recorded.pid, "SIGKILL")
    return true
  } catch {
    return false
  }
}

const running = sql`json_extract(${MonitorTable.data}, '$.status') = 'running'`

export const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const jobs = yield* BackgroundJob.Service
  const scope = yield* Scope.Scope
  const lock = yield* Semaphore.make(1)
  const owner = `${self}:${crypto.randomUUID()}`
  live.add(owner)
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      live.delete(owner)
    }),
  )

  const save = (info: Monitor.Info) =>
    database.db
      .update(MonitorTable)
      .set({ data: info })
      .where(and(eq(MonitorTable.id, info.id), eq(MonitorTable.owner, owner)))
      .run()
      .pipe(Effect.orDie)

  const recover = Effect.fn("Monitor.recover")(function* (row: typeof MonitorTable.$inferSelect) {
    if (row.data.status !== "running") return row.data
    // Our own rows settle through their job's exit; a live runtime's rows are not ours to judge.
    if (row.owner === owner || ownerAlive(row.owner)) return row.data
    // A durable identity is not a durable process handle. Never repeat a command during recovery.
    const interrupted: Monitor.Info = {
      ...row.data,
      status: "interrupted",
      delivery: "suppressed",
      updated: yield* Clock.currentTimeMillis,
      interruptedBy: owner,
      error:
        "Execution ownership was lost. Inspect the external operation before explicitly starting a new observation.",
    }
    yield* database.db
      .update(MonitorTable)
      .set({ data: interrupted })
      .where(and(eq(MonitorTable.id, row.id), eq(MonitorTable.owner, row.owner), running))
      .run()
      .pipe(Effect.orDie)
    if (reap(row.data.process))
      yield* Effect.logWarning("reaped the process group of an interrupted monitor", {
        id: row.id,
        pid: row.data.process?.pid,
      })
    return interrupted
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

  // After a crash nothing else would look at these rows again: settle them, and reap what they left.
  const orphaned = yield* database.db.select().from(MonitorTable).where(running).all().pipe(Effect.orDie)
  yield* Effect.forEach(orphaned, recover, { discard: true })

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
            const track = (pid: number) =>
              Effect.gen(function* () {
                const found = processInfo(pid)
                if (!found) return
                current = { ...current, process: { pid, started: found.started } }
                yield* save(current)
              })
            const run = Effect.gen(function* () {
              while (true) {
                const evidence = yield* input.run(track)
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
                yield* Effect.sleep(input.options.interval_ms ?? Monitor.DEFAULT_INTERVAL_MS)
              }
            }).pipe(
              Effect.timeoutOption(Monitor.deadline(input.options)),
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
