export * as Monitor from "./monitor"

import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { and, eq, sql } from "drizzle-orm"
import { Cause, Clock, Context, Effect, Layer, Scope, Semaphore } from "effect"
import { Monitor } from "@reddb-io/redcode-schema/monitor"
import { BackgroundJob } from "./background-job"
import { Verbose } from "./observability/verbose"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { MonitorTable } from "./monitor.sql"
import { SafeRegex } from "./safe-regex"

export { Info, Evidence, Options } from "@reddb-io/redcode-schema/monitor"

export type Start = {
  sessionID: string
  originMessageID?: string
  autonomous?: boolean
  /** The polled command, or for a probe monitor its label (`Monitor.probeLabel`). */
  command: string
  workdir: string
  options: Monitor.Options
  /** Set for a native probe monitor; `run` evaluates it and reports `evidence.probe`. */
  probe?: Monitor.Probe
  /** The longest one attempt may take; the last attempt starts at least this long before the deadline. */
  attemptTimeoutMs?: number
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
/** What a probe found: the process, no such process, or no answer at all (a failed or timed-out probe). */
export type Probe = Identity | undefined | "unknown"

/** The process runner behind `ps` and `pgrep`, replaceable so tests can make it fail. */
export const probe: {
  spawn: (command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) => SpawnSyncReturns<string>
} = { spawn: spawnSync }

/** The random source behind poll jitter, replaceable so tests can make schedules deterministic. */
export const jitter: { random: () => number } = { random: Math.random }

const PROBE_OPTIONS: SpawnSyncOptionsWithStringEncoding = {
  encoding: "utf8",
  timeout: 2_000,
  // `ps -o lstart` is localised; a start time must compare equal across runtimes.
  env: { ...process.env, LC_ALL: "C" },
}

const identifiableOn = (platform: NodeJS.Platform) => platform === "linux" || platform === "darwin"

/** Whether this platform can tell a process from an unrelated one that reused its pid. */
export const identifiable = identifiableOn(process.platform)

const probes = new Map<number, { at: number; value: Identity | undefined }>()

/**
 * A process's start time and process group. Linux reads `/proc`; macOS asks `ps`, caching only
 * definite answers briefly since every monitor read may ask. A probe that fails says "unknown",
 * never "gone": nothing is interrupted or killed on a missing answer.
 */
export function processInfo(pid: number, platform: NodeJS.Platform = process.platform): Probe {
  if (!identifiableOn(platform) || !Number.isInteger(pid) || pid <= 0) return undefined
  if (platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
      // The command name is parenthesised and may contain spaces; fields are counted after it.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
      if (fields[0] === "Z") return undefined
      const started = fields[19]
      return started ? { started, group: Number(fields[2]) } : "unknown"
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      return code === "ENOENT" || code === "ESRCH" ? undefined : "unknown"
    }
  }
  const cached = probes.get(pid)
  if (cached && Date.now() - cached.at < 5_000) return cached.value
  const result = probe.spawn("ps", ["-o", "pgid=", "-o", "lstart=", "-p", String(pid)], PROBE_OPTIONS)
  if (result.error || result.signal || typeof result.stdout !== "string") return "unknown"
  const match = /^\s*(\d+)\s+(\S.*?)\s*$/.exec(result.stdout)
  // `ps -p` exits 1 with no output when there is no such process; anything else is no answer.
  const value: Probe = match
    ? { group: Number(match[1]), started: match[2]! }
    : result.status === 1 && result.stdout.trim() === ""
      ? undefined
      : "unknown"
  if (value === "unknown") return value
  probes.set(pid, { at: Date.now(), value })
  return value
}

/** Live processes in a process group, or undefined where that cannot be listed or the listing failed. */
export function groupMembers(group: number, platform: NodeJS.Platform = process.platform) {
  if (platform === "linux") {
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
  if (platform === "darwin") {
    const result = probe.spawn("pgrep", ["-g", String(group)], PROBE_OPTIONS)
    if (result.error || result.signal || typeof result.stdout !== "string") return undefined
    // pgrep exits 1 when nothing matches.
    if (result.status === 1) return 0
    if (result.status !== 0) return undefined
    return result.stdout.split("\n").filter(Boolean).length
  }
  return undefined
}

/** Start times hold spaces and colons on macOS; owners are colon-separated. */
const encode = (started: string) => Buffer.from(started).toString("base64url")

/** Owners of the monitor runtimes alive in this process. */
const live = new Set<string>()
let selfIdentity: string | undefined
const self = () => {
  if (selfIdentity) return selfIdentity
  const found = processInfo(process.pid)
  return (selfIdentity = `${process.pid}:${encode(typeof found === "object" ? found.started : "")}`)
}

/**
 * What is known about the runtime that owns a row. Owners are `pid:start-time:uuid`.
 * - `alive`: a runtime in this process, or a process whose pid still has that start time.
 * - `dead`: provably gone.
 * - `unverified`: the pid exists, but without a start time (Windows) it may belong to anyone.
 * - `unknown`: the probe gave no answer.
 */
export function ownerStatus(owner: string): "alive" | "dead" | "unverified" | "unknown" {
  if (live.has(owner)) return "alive"
  const [pid, started, id] = owner.split(":")
  if (!pid || started === undefined || !id) return "dead"
  if (`${pid}:${started}` === self()) return "dead"
  if (identifiable && started !== "") {
    const found = processInfo(Number(pid))
    if (found === "unknown") return "unknown"
    return found && encode(found.started) === started ? "alive" : "dead"
  }
  try {
    process.kill(Number(pid), 0)
    return "unverified"
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM" ? "unverified" : "dead"
  }
}

/** How far past its deadline a row with an unverifiable owner may run before it is treated as stale. */
export const EXPIRY_GRACE_MS = 60_000

export function expired(info: Monitor.Info, now: number) {
  return now > info.created + Monitor.deadline(info.options) + EXPIRY_GRACE_MS
}

/**
 * What to do about the process an interrupted monitor left behind. Its group is stopped only when
 * `kill` is allowed (the owner is provably gone) and the recorded leader provably still runs;
 * anything that may still be running is named, pid and command, so the person can stop it.
 */
export function settle(
  recorded: Monitor.Process | undefined,
  command: string,
  options: { kill: boolean },
): { cleanup: NonNullable<Monitor.Info["cleanup"]>; note: string } | undefined {
  if (!recorded) return undefined
  const { pid } = recorded
  const current = processInfo(pid)
  if (current === "unknown")
    return {
      cleanup: "unknown",
      note: `Its process ${pid} (${command}) may still be running; check for it and stop it yourself if so.`,
    }
  const same = current !== undefined && recorded.started !== "" && current.started === recorded.started
  if (same && current.group === pid) {
    if (!options.kill)
      return {
        cleanup: "left-running",
        note: `Its process group ${pid} (${command}) may still be running and was left alone because its owner could not be confirmed gone; stop it yourself if so (kill -- -${pid}).`,
      }
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
  const members = identifiable ? groupMembers(pid) : undefined
  if (members === undefined)
    return {
      cleanup: "unknown",
      note: `Its process ${pid} (${command}) may still be running; check for it and stop it yourself if so.`,
    }
  if (members === 0) return { cleanup: "exited", note: `Its process ${pid} (${command}) is no longer running.` }
  return {
    cleanup: "left-running",
    note: same
      ? `Its process ${pid} (${command}) is still running but no longer leads its process group, so it was left alone; stop it yourself if it is still needed (kill ${pid}).`
      : `The leader of process group ${pid} (${command}) exited, but ${members} process(es) in that group may still be running; stop them yourself if they belong to it (kill -- -${pid}).`,
  }
}

/** Consecutive regular-expression timeouts after which a monitor fails instead of polling a pattern that cannot finish. */
export const REGEX_TIMEOUT_LIMIT = 3

/** Runs a command poll's regular expressions in the worker, and notes any that could not finish. */
const regexOutcomes = (matcher: SafeRegex.Matcher, options: Monitor.Options, evidence: Monitor.Evidence) =>
  Effect.promise(async () => {
    const outcomes: { success?: Monitor.RegexOutcome; failure?: Monitor.RegexOutcome } = {}
    const errors: string[] = []
    if (evidence.probe)
      return { outcomes, errors, timedOut: evidence.probe.error?.includes(SafeRegex.TIMEOUT_ERROR) === true }
    const text = evidence.output.slice(-Monitor.REGEX_INPUT_CHARS)
    let timedOut = false
    for (const key of ["failure", "success"] as const) {
      const source = key === "success" ? options.success_regex : options.failure_regex
      if (source === undefined) continue
      const outcome = await matcher.exec(source, text)
      if ("timedOut" in outcome) {
        timedOut = true
        errors.push(`${key}_regex ${SafeRegex.TIMEOUT_ERROR} after ${SafeRegex.MATCH_TIMEOUT_MS} ms`)
        outcomes[key] = outcome
      } else if ("error" in outcome) {
        errors.push(`${key}_regex could not run: ${outcome.error}`)
        outcomes[key] = { match: undefined }
      } else outcomes[key] = outcome
    }
    return { outcomes, errors, timedOut }
  })

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
    const status = ownerStatus(found.owner)
    // A verified-live owner enforces its own deadline; this clock may have jumped past it (a laptop
    // that slept, an NTP correction) while the owner's timer did not. No answer is not a verdict.
    if (status === "alive" || status === "unknown") return found.data
    const now = yield* Clock.currentTimeMillis
    // Without a verifiable identity (Windows) the pid may be anyone's: expire at the deadline, never kill.
    if (status === "unverified" && !expired(found.data, now)) return found.data
    // A durable identity is not a durable process handle. Never repeat a command during recovery.
    const interrupted: Monitor.Info = {
      ...found.data,
      status: "interrupted",
      delivery: "suppressed",
      updated: now,
      interruptedBy: owner,
      error: `${status === "unverified" ? "The monitor passed its deadline and its owner could not be verified." : "Execution ownership was lost."} Inspect the external operation before explicitly starting a new observation.`,
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
    const cleanup = settle(found.data.process, found.data.command, { kill: status === "dead" })
    if (!cleanup) return interrupted
    const settled: Monitor.Info = {
      ...interrupted,
      cleanup: cleanup.cleanup,
      error: `${interrupted.error} ${cleanup.note}`,
    }
    yield* database.db
      .update(MonitorTable)
      .set({ data: settled })
      .where(eq(MonitorTable.id, found.id))
      .run()
      .pipe(Effect.orDie)
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
              ...(input.probe ? { probe: input.probe } : {}),
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
            yield* Verbose.log("monitor.started", {
              sessionID: input.sessionID,
              monitorID: initial.id,
              mode: input.options.mode,
              autonomous: input.autonomous ?? false,
              probe: Boolean(input.probe),
            })
            let current = initial
            const initialInfo = initial
            // Recorded even where no start time can be read, so recovery can at least name the pid.
            const track = (pid: number) =>
              Effect.gen(function* () {
                const found = processInfo(pid)
                current = { ...current, process: { pid, started: typeof found === "object" ? found.started : "" } }
                yield* save(current)
              })
            /** The first attempt's normalized output, which `until: "changed"` compares against. */
            let baseline: string | undefined
            /** Attempts in a row whose regular expression timed out. */
            let timeouts = 0
            /** This monitor's own regex worker, so a stuck pattern here never delays another monitor. */
            const matcher = SafeRegex.create()
            const run = Effect.gen(function* () {
              const initial = Monitor.initialDelay(input.options, jitter.random)
              if (initial > 0) yield* Effect.sleep(initial)
              while (true) {
                const observed = yield* input.run(track)
                const regex = yield* regexOutcomes(matcher, input.options, observed)
                timeouts = regex.timedOut ? timeouts + 1 : 0
                const evidence: Monitor.Evidence =
                  regex.errors.length > 0 ? { ...observed, error: regex.errors.join("; ") } : observed
                const now = yield* Clock.currentTimeMillis
                const decided =
                  timeouts >= REGEX_TIMEOUT_LIMIT
                    ? {
                        status: "failed" as const,
                        matched: `the regular expression timed out ${timeouts} times in a row`,
                      }
                    : Monitor.verdict(input.options, evidence, baseline, regex.outcomes)
                if (baseline === undefined && !evidence.probe) baseline = Monitor.normalizeOutput(evidence.output)
                current = {
                  ...current,
                  updated: now,
                  attempts: current.attempts + 1,
                  evidence: decided ? { ...evidence, matched: decided.matched } : evidence,
                  status: decided
                    ? decided.status
                    : input.options.mode === "once"
                      ? evidence.timedOut
                        ? "timed_out"
                        : "failed"
                      : "running",
                }
                yield* save(current)
                if (current.status !== "running") {
                  yield* Verbose.log("monitor.settled", {
                    sessionID: input.sessionID,
                    monitorID: current.id,
                    status: current.status,
                    attempts: current.attempts,
                    ms: now - initialInfo.created,
                  })
                  return
                }
                const delay = Monitor.nextDelay(
                  input.options,
                  (yield* Clock.currentTimeMillis) - initialInfo.created,
                  jitter.random,
                  input.attemptTimeoutMs,
                )
                // No attempt fits before the deadline: wait for it, so the monitor times out as before.
                if (delay === undefined) return yield* Effect.never
                yield* Effect.sleep(delay)
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
                  matcher.close()
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
