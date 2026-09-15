export * as Monitor from "./monitor"

import { spawnSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
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
   * that restarts after a crash can stop that group, or at least name it, instead of forgetting it.
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

type Identity = { started: string; group: number }

/** Whether this platform can tell a process from an unrelated one that reused its pid. */
export const identifiable = process.platform === "linux" || process.platform === "darwin"

const probes = new Map<number, { at: number; value: Identity | undefined }>()

/**
 * A process's start time and process group. Linux reads `/proc`; macOS asks `ps` (cached briefly,
 * since every monitor read may ask). Elsewhere there is no cheap answer, so there is none.
 */
export function processInfo(pid: number): Identity | undefined {
  if (!identifiable || !Number.isInteger(pid) || pid <= 0) return undefined
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
      // The command name is parenthesised and may contain spaces; fields are counted after it.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
      if (fields[0] === "Z") return undefined
      const started = fields[19]
      return started ? { started, group: Number(fields[2]) } : undefined
    } catch {
      return undefined
    }
  }
  const cached = probes.get(pid)
  if (cached && Date.now() - cached.at < 5_000) return cached.value
  const result = spawnSync("ps", ["-o", "pgid=", "-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
    timeout: 2_000,
  })
  const match = result.status === 0 ? /^\s*(\d+)\s+(\S.*?)\s*$/.exec(result.stdout) : null
  const value = match ? { group: Number(match[1]), started: match[2]! } : undefined
  probes.set(pid, { at: Date.now(), value })
  return value
}

/** Live processes in a process group, or undefined where that cannot be listed. */
function groupMembers(group: number) {
  if (process.platform === "linux") {
    try {
      return readdirSync("/proc").filter((name) => {
        if (!/^\d+$/.test(name)) return false
        try {
          const stat = readFileSync(`/proc/${name}/stat`, "utf8")
          const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
          return fields[0] !== "Z" && Number(fields[2]) === group
        } catch {
          return false
        }
      }).length
    } catch {
      return undefined
    }
  }
  if (process.platform === "darwin") {
    const result = spawnSync("pgrep", ["-g", String(group)], { encoding: "utf8", timeout: 2_000 })
    return result.stdout.split("\n").filter(Boolean).length
  }
  return undefined
}

/** Start times hold spaces and colons on macOS; owners are colon-separated. */
const encode = (started: string) => Buffer.from(started).toString("base64url")

/** Owners of the monitor runtimes alive in this process. */
const live = new Set<string>()
let selfIdentity: string | undefined
const self = () => (selfIdentity ??= `${process.pid}:${encode(processInfo(process.pid)?.started ?? "")}`)

/**
 * Whether the runtime that owns a row may still be running its monitors. Owners are
 * `pid:start-time:uuid`. This process knows its own runtimes; another is alive while its pid still
 * has its start time. Without a start time (Windows) only the pid can be checked, which a reused pid
 * can fool, so rows there also expire at their deadline.
 */
export function ownerAlive(owner: string) {
  if (live.has(owner)) return true
  const [pid, started, id] = owner.split(":")
  if (!pid || started === undefined || !id) return false
  if (`${pid}:${started}` === self()) return false
  if (identifiable && started !== "") return encode(processInfo(Number(pid))?.started ?? "") === started
  try {
    process.kill(Number(pid), 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/** How far past its deadline a running row may be before it is stale, whoever owns it. */
export const EXPIRY_GRACE_MS = 60_000

/** A live owner records a timeout at the deadline; a row still running well after it has no owner left. */
export function expired(info: Monitor.Info, now: number) {
  return now > info.created + Monitor.deadline(info.options) + EXPIRY_GRACE_MS
}

/**
 * What to do about the process an interrupted monitor left behind. Its group is stopped only when
 * the recorded leader provably still runs; anything that may still be running is named, pid and
 * command, so the person can stop it.
 */
export function settle(
  recorded: Monitor.Process | undefined,
  command: string,
): { cleanup: NonNullable<Monitor.Info["cleanup"]>; note: string } | undefined {
  if (!recorded) return undefined
  const { pid } = recorded
  const current = processInfo(pid)
  const same = current !== undefined && recorded.started !== "" && current.started === recorded.started
  if (same && current.group === pid) {
    try {
      process.kill(-pid, "SIGKILL")
      return { cleanup: "reaped", note: `Its process group ${pid} (${command}) was stopped.` }
    } catch {
      return {
        cleanup: "left-running",
        note: `Its process group ${pid} (${command}) could not be stopped and may still be running; stop it yourself (kill -- -${pid}).`,
      }
    }
  }
  if (!identifiable)
    return {
      cleanup: "unknown",
      note: `Its process ${pid} (${command}) may still be running; check for it and stop it yourself if so.`,
    }
  const members = groupMembers(pid) ?? 0
  if (members === 0) return { cleanup: "exited", note: `Its process ${pid} (${command}) is no longer running.` }
  return {
    cleanup: "left-running",
    note: same
      ? `Its process ${pid} (${command}) is still running but no longer leads its process group, so it was left alone; stop it yourself if it is still needed (kill ${pid}).`
      : `The leader of process group ${pid} (${command}) exited, but ${members} process(es) in that group may still be running; stop them yourself if they belong to it (kill -- -${pid}).`,
  }
}

const running = sql`json_extract(${MonitorTable.data}, '$.status') = 'running'`

export const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const jobs = yield* BackgroundJob.Service
  const scope = yield* Scope.Scope
  const lock = yield* Semaphore.make(1)
  const owner = `${self()}:${crypto.randomUUID()}`
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

  const row = (id: string) =>
    database.db.select().from(MonitorTable).where(eq(MonitorTable.id, id)).get().pipe(Effect.orDie)

  const recover = Effect.fn("Monitor.recover")(function* (found: typeof MonitorTable.$inferSelect) {
    if (found.data.status !== "running") return found.data
    // Our own rows settle through their job's exit.
    if (found.owner === owner) return found.data
    const now = yield* Clock.currentTimeMillis
    const stale = expired(found.data, now)
    if (!stale && ownerAlive(found.owner)) return found.data
    // A durable identity is not a durable process handle. Never repeat a command during recovery.
    const interrupted: Monitor.Info = {
      ...found.data,
      status: "interrupted",
      delivery: "suppressed",
      updated: now,
      interruptedBy: owner,
      error: `${stale ? "The monitor passed its deadline without its owner recording a result." : "Execution ownership was lost."} Inspect the external operation before explicitly starting a new observation.`,
    }
    yield* database.db
      .update(MonitorTable)
      .set({ data: interrupted })
      .where(and(eq(MonitorTable.id, found.id), eq(MonitorTable.owner, found.owner), running))
      .run()
      .pipe(Effect.orDie)
    const current = (yield* row(found.id))?.data
    // Another runtime got there first: its record, and its cleanup, stand.
    if (current?.interruptedBy !== owner || current.updated !== now) return current ?? interrupted
    const cleanup = settle(found.data.process, found.data.command)
    if (!cleanup) return interrupted
    const settled: Monitor.Info = {
      ...interrupted,
      cleanup: cleanup.cleanup,
      error: `${interrupted.error} ${cleanup.note}`,
    }
    yield* database.db.update(MonitorTable).set({ data: settled }).where(eq(MonitorTable.id, found.id)).run().pipe(Effect.orDie)
    if (cleanup.cleanup !== "exited")
      yield* Effect.logWarning("interrupted monitor left a process behind", {
        id: found.id,
        cleanup: cleanup.cleanup,
        detail: cleanup.note,
      })
    return settled
  })

  const get = Effect.fn("Monitor.get")(function* (sessionID: string, id: string) {
    const found = yield* database.db
      .select()
      .from(MonitorTable)
      .where(and(eq(MonitorTable.session_id, sessionID), eq(MonitorTable.id, id)))
      .get()
      .pipe(Effect.orDie)
    return found ? yield* recover(found) : undefined
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

  // After a crash nothing else would look at these rows again: settle them, and what they left.
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
            // Recorded even where no start time can be read, so recovery can at least name the pid.
            const track = (pid: number) =>
              Effect.gen(function* () {
                current = { ...current, process: { pid, started: processInfo(pid)?.started ?? "" } }
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
