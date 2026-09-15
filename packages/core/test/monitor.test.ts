import { describe, expect } from "bun:test"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { Deferred, Effect, Exit, Scope } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { eq } from "drizzle-orm"
import { Monitor as MonitorSchema } from "@reddb-io/redcode-schema/monitor"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Monitor } from "../src/monitor"
import { MonitorTable } from "../src/monitor.sql"
import { Database } from "../src/database/database"
import { BackgroundJob } from "../src/background-job"
import { AppProcess } from "../src/process"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { SessionSchema } from "../src/session/schema"
import { AbsolutePath } from "../src/schema"
import { testEffect } from "./lib/effect"

// Jitter is covered by its own pure tests; here polls start at once and keep their timing.
Monitor.jitter.random = () => 0

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Monitor.node, AppProcess.node, Database.node, BackgroundJob.node])),
)
const setup = Effect.gen(function* () {
  const database = yield* Database.Service
  const id = SessionSchema.ID.make(`ses_${crypto.randomUUID()}`)
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* database.db
    .insert(SessionTable)
    .values({
      id,
      project_id: Project.ID.global,
      directory: "/project",
      title: "Monitor",
      slug: "monitor",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  return id
})
const evidence = { exit: 0, output: "ready", truncated: false }
const base = {
  command: "status",
  workdir: "/project",
  options: { mode: "once" as const },
  notify: () => Effect.die("Unexpected notification"),
}

/** An owner no runtime holds: a pid that does not exist. */
const GONE = "999999999:1:gone"

/** A running row left by a runtime that crashed. */
const orphan = (sessionID: string, patch: Partial<Monitor.Info> = {}, owner = GONE) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const info: Monitor.Info = {
      id: `monitor_${crypto.randomUUID()}`,
      sessionID,
      command: "status",
      workdir: "/project",
      options: { mode: "once" },
      status: "running",
      created: 1,
      updated: 1,
      attempts: 0,
      delivery: "pending",
      ...patch,
    }
    yield* database.db
      .insert(MonitorTable)
      .values({ id: info.id, session_id: sessionID, owner, data: info })
      .run()
      .pipe(Effect.orDie)
    return info
  })

/** Exited, or a zombie nobody has reaped yet. */
const exited = (pid: number) => {
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
      return stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")
    } catch {
      return true
    }
  }
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}

const until = (check: () => boolean) =>
  Effect.gen(function* () {
    for (let i = 0; i < 250 && !check(); i++) yield* Effect.sleep("20 millis")
    return check()
  })

/** The start time recovery compares, for a process this test started. */
const identity = (pid: number) => {
  const found = Monitor.processInfo(pid)
  if (!found || found === "unknown") throw new Error(`no identity for ${pid}`)
  return found.started
}

/** A detached process group that stands in for a monitor's command. */
const group = () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" })
  child.unref()
  return child
}

const stop = (child: ReturnType<typeof spawn>) => {
  try {
    if (process.platform === "win32") child.kill()
    else process.kill(-child.pid!, "SIGKILL")
  } catch {}
}

describe("Monitors", () => {
  it.live("keeps the same real process alive after yielding and reaps it on cancellation", () =>
    Effect.gen(function* () {
      const monitors = yield* Monitor.Service
      const processes = yield* AppProcess.Service
      const sessionID = yield* setup
      const started = yield* Deferred.make<number>()
      const info = yield* monitors.start({
        ...base,
        sessionID,
        options: { mode: "once", wait_ms: 0 },
        run: () =>
          Effect.scoped(
            Effect.gen(function* () {
              const child = yield* processes.spawn(
                ChildProcess.make(process.execPath, ["-e", "setInterval(() => {}, 1000)"]),
              )
              yield* Deferred.succeed(started, child.pid)
              yield* child.exitCode
              return evidence
            }),
          ).pipe(Effect.orDie),
      })
      const pid = yield* Deferred.await(started)
      expect((yield* monitors.wait(sessionID, info.id, 0))?.status).toBe("running")
      expect(exited(pid)).toBe(false)
      expect((yield* monitors.cancel(sessionID, info.id))?.status).toBe("cancelled")
      // Process teardown is asynchronous on every platform; give it a bounded moment.
      expect(yield* until(() => exited(pid))).toBe(true)
    }),
  )

  it.live("bounds autonomous monitor chains until a new human request", () =>
    Effect.gen(function* () {
      const monitors = yield* Monitor.Service
      const sessionID = yield* setup
      for (const index of [0, 1, 2]) {
        yield* monitors.start({
          ...base,
          sessionID,
          originMessageID: "human-one",
          autonomous: index > 0,
          run: () => Effect.succeed(evidence),
        })
      }
      const fourth = yield* monitors
        .start({
          ...base,
          sessionID,
          originMessageID: "human-one",
          autonomous: true,
          run: () => Effect.succeed(evidence),
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(fourth)).toBe(true)
      expect(
        (yield* monitors.start({
          ...base,
          sessionID,
          originMessageID: "human-two",
          run: () => Effect.succeed(evidence),
        })).status,
      ).toBe("succeeded")
    }),
  )

  it.live("reports per-command timeout and explicit failure predicates", () =>
    Effect.gen(function* () {
      const monitors = yield* Monitor.Service
      const sessionID = yield* setup
      const timed = yield* monitors.start({
        ...base,
        sessionID,
        run: () => Effect.succeed({ ...evidence, exit: null, timedOut: true }),
      })
      expect(timed.status).toBe("timed_out")
      const failed = yield* monitors.start({
        ...base,
        sessionID,
        options: { mode: "poll", success_contains: "ready", failure_contains: "failed" },
        run: () => Effect.succeed({ ...evidence, output: "ready failed" }),
      })
      expect(failed.status).toBe("failed")
      expect(failed.attempts).toBe(1)
    }),
  )

  it.live("runs a real one-shot command once and returns inline without notifying", () =>
    Effect.gen(function* () {
      const monitors = yield* Monitor.Service
      const processes = yield* AppProcess.Service
      let starts = 0
      const result = yield* monitors.start({
        ...base,
        sessionID: yield* setup,
        run: () =>
          Effect.sync(() => starts++).pipe(
            Effect.andThen(
              processes.run(ChildProcess.make(process.execPath, ["-e", "console.log('ready')"]), {
                combineOutput: true,
                maxOutputBytes: 1024,
              }),
            ),
            Effect.orDie,
            Effect.map((result) => ({ exit: result.exitCode, output: result.output!.toString(), truncated: false })),
          ),
      })
      expect(starts).toBe(1)
      expect(result).toMatchObject({
        status: "succeeded",
        delivery: "observed",
        attempts: 1,
      })
      expect(result.evidence?.output.trim()).toBe("ready")
    }),
  )

  it.live("settles a probe monitor as soon as its probe matches, recording what matched", () =>
    Effect.gen(function* () {
      const monitors = yield* Monitor.Service
      const sessionID = yield* setup
      let attempts = 0
      const info = yield* monitors.start({
        ...base,
        sessionID,
        command: "probe: GET http://127.0.0.1/health",
        probe: { type: "http", url: "http://127.0.0.1/health" },
        options: { mode: "poll", wait_ms: 0, interval_ms: 1_000, deadline_ms: 30_000 },
        run: () =>
          Effect.sync(() => {
            attempts++
            const matched = attempts > 1
            return {
              exit: matched ? 0 : 1,
              output: `HTTP ${matched ? 200 : 503} (expected 2xx)`,
              truncated: false,
              probe: { matched, status: matched ? 200 : 503 },
            }
          }),
        notify: () => Effect.void,
      })
      expect(info.status).toBe("running")
      const done = yield* monitors.wait(sessionID, info.id, 5_000)
      expect(done).toMatchObject({
        status: "succeeded",
        attempts: 2,
        probe: { type: "http" },
        evidence: { matched: "HTTP 200 (expected 2xx)", probe: { matched: true, status: 200 } },
      })
    }),
  )

  it.live("recovers a persisted jittered probe monitor after a crash without running it again", () =>
    Effect.gen(function* () {
      const monitors = yield* Monitor.Service
      const sessionID = yield* setup
      const row = yield* orphan(sessionID, {
        command: "probe: process \"vite\" exited",
        options: { mode: "poll", interval_ms: 2_000, deadline_ms: 60_000, jitter: true, until: "changed" },
        probe: { type: "process", name: "vite", state: "exited" },
      })
      const [recovered] = yield* monitors.list(sessionID)
      expect(recovered).toMatchObject({
        id: row.id,
        status: "interrupted",
        delivery: "suppressed",
        attempts: 0,
        options: { jitter: true },
        probe: { type: "process" },
      })
      expect(MonitorSchema.render(recovered!)).toContain('"schedule":"every 2s ±250ms"')
    }),
  )

  it.live("a wait timeout preserves work and sends exactly one completion to its owner", () =>
    Effect.gen(function* () {
      const monitors = yield* Monitor.Service
      const sessionID = yield* setup
      const release = yield* Deferred.make<void>()
      const delivered = yield* Deferred.make<Monitor.Info>()
      let notifications = 0
      const info = yield* monitors.start({
        ...base,
        sessionID,
        options: { mode: "once", wait_ms: 0 },
        run: () => Deferred.await(release).pipe(Effect.as(evidence)),
        notify: (info) =>
          Effect.sync(() => notifications++).pipe(Effect.andThen(Deferred.succeed(delivered, info)), Effect.asVoid),
      })
      expect((yield* monitors.wait(sessionID, info.id, 0))?.status).toBe("running")
      expect(yield* monitors.get("other", info.id)).toBeUndefined()
      expect(yield* monitors.cancel("other", info.id)).toBeUndefined()
      expect(yield* monitors.list("other")).toEqual([])
      yield* Deferred.succeed(release, undefined)
      expect((yield* Deferred.await(delivered)).status).toBe("succeeded")
      yield* monitors.wait(sessionID, info.id, 100)
      expect(notifications).toBe(1)
    }),
  )

  it.live("cancel waits for cleanup and suppresses automatic continuation", () =>
    Effect.gen(function* () {
      const monitors = yield* Monitor.Service
      const sessionID = yield* setup
      const started = yield* Deferred.make<void>()
      let cleaned = false
      const info = yield* monitors.start({
        ...base,
        sessionID,
        options: { mode: "once", wait_ms: 0 },
        run: () =>
          Effect.scoped(
            Effect.addFinalizer(() =>
              Effect.sync(() => {
                cleaned = true
              }),
            ).pipe(Effect.andThen(Deferred.succeed(started, undefined)), Effect.andThen(Effect.never)),
          ),
      })
      yield* Deferred.await(started)
      expect((yield* monitors.cancel(sessionID, info.id))?.status).toBe("cancelled")
      expect(cleaned).toBe(true)
      expect((yield* monitors.get(sessionID, info.id))?.delivery).toBe("suppressed")
    }),
  )

  it.live("polls deterministically until the condition and distinguishes nonzero exit from success", () =>
    Effect.gen(function* () {
      const monitors = yield* Monitor.Service
      let attempts = 0
      const result = yield* monitors.start({
        ...base,
        sessionID: yield* setup,
        options: { mode: "poll", interval_ms: 1, wait_ms: 1_000, success_contains: "ready" },
        run: () => Effect.sync(() => ({ ...evidence, exit: ++attempts < 3 ? 1 : 0 })),
      })
      expect(result).toMatchObject({ status: "succeeded", attempts: 3 })
      const failed = yield* monitors.start({
        ...base,
        sessionID: yield* setup,
        run: () => Effect.succeed({ ...evidence, exit: 2 }),
      })
      expect(failed.status).toBe("failed")
    }),
  )

  it.live("observation deadlines stop pending work with an explicit timeout", () =>
    Effect.gen(function* () {
      const monitors = yield* Monitor.Service
      const result = yield* monitors.start({
        ...base,
        sessionID: yield* setup,
        options: { mode: "poll", deadline_ms: 10, wait_ms: 1_000 },
        run: () => Effect.never,
      })
      expect(result.status).toBe("timed_out")
    }),
  )

  it.live("another live runtime on the same database keeps its monitors running", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup
      const scope = yield* Scope.make()
      const background = yield* BackgroundJob.make.pipe(Scope.provide(scope))
      const first = yield* Monitor.make.pipe(
        Effect.provideService(BackgroundJob.Service, background),
        Scope.provide(scope),
      )
      const info = yield* first.start({
        ...base,
        sessionID,
        options: { mode: "once", wait_ms: 0 },
        run: () => Effect.never,
      })
      const second = yield* Monitor.make
      expect((yield* second.get(sessionID, info.id))?.status).toBe("running")
      expect((yield* second.list(sessionID))[0]?.status).toBe("running")
      yield* Scope.close(scope, Exit.void)
      expect((yield* second.get(sessionID, info.id))?.status).toBe("cancelled")
    }),
  )

  it.live("records a crashed owner's monitor as interrupted, once, and never replays its command", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const sessionID = yield* setup
      const left = yield* orphan(sessionID)
      const recovered = yield* Monitor.make
      const seen = yield* recovered.get(sessionID, left.id)
      expect(seen).toMatchObject({ status: "interrupted", delivery: "suppressed", attempts: 0 })
      expect(seen?.interruptedBy).toBeString()
      // Persisted by the runtime that noticed, so every later reader agrees without judging again.
      const row = yield* database.db
        .select()
        .from(MonitorTable)
        .where(eq(MonitorTable.id, left.id))
        .get()
        .pipe(Effect.orDie)
      expect(row?.data).toMatchObject({ status: "interrupted", interruptedBy: seen?.interruptedBy })
      expect((yield* (yield* Monitor.make).get(sessionID, left.id))?.interruptedBy).toBe(seen?.interruptedBy)
    }),
  )

  it.live("reaps the process group an interrupted monitor left behind, and never a reused pid", () =>
    Effect.gen(function* () {
      if (process.platform !== "linux") return
      const sessionID = yield* setup
      const group = () => {
        const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" })
        child.unref()
        return child.pid!
      }
      const leftover = group()
      const stranger = group()
      try {
        yield* orphan(sessionID, { process: { pid: leftover, started: identity(leftover) } })
        // Same pid, different start time: another process that happens to hold the number now.
        yield* orphan(sessionID, { process: { pid: stranger, started: "1" } })
        const recovered = yield* Monitor.make
        expect(yield* until(() => exited(leftover))).toBe(true)
        expect(exited(stranger)).toBe(false)
        const [reaped, spared] = [yield* recovered.list(sessionID)].flat().toSorted((a) => (a.process?.pid === leftover ? -1 : 1))
        // Both outcomes are recorded on the row, with the pid and command to act on.
        expect(reaped).toMatchObject({ status: "interrupted", cleanup: "reaped" })
        expect(reaped?.error).toContain(`process group ${leftover} (status) was stopped`)
        expect(spared).toMatchObject({ status: "interrupted", cleanup: "left-running" })
        expect(spared?.error).toContain(`${stranger} (status)`)
      } finally {
        for (const pid of [leftover, stranger])
          try {
            process.kill(-pid, "SIGKILL")
          } catch {}
      }
    }),
  )

  it.live("caps evidence per monitor and across a list", () =>
    Effect.sync(() => {
      const info = (id: string, updated: number): MonitorSchema.Info => ({
        id,
        sessionID: "ses",
        command: "status",
        workdir: "/project",
        options: { mode: "poll" },
        status: "running",
        created: 1,
        updated,
        attempts: 1,
        delivery: "pending",
        evidence: { exit: 0, output: `${id}:` + "x".repeat(20_000), truncated: false },
      })
      const one = JSON.parse(MonitorSchema.render(info("a", 1)))
      expect(one.evidence.output).toHaveLength(MonitorSchema.EVIDENCE_CHARS)
      expect(one.evidence.truncated).toBe(true)
      const list = JSON.parse(MonitorSchema.renderList(["a", "b", "c", "d", "e"].map((id, index) => info(id, index))))
      const kept = list.reduce((total: number, item: MonitorSchema.Info) => total + item.evidence!.output.length, 0)
      expect(kept).toBeLessThanOrEqual(MonitorSchema.LIST_CHARS)
      expect(list[0].id).toBe("e")
      expect(list.at(-1).evidence.output).toBe("")
      expect(MonitorSchema.printable("\u001b[31mred\u001b[0m\u0007 [ok]\tdone\n")).toBe("red [ok]\tdone\n")
    }),
  )

  it.live("names a process it could not verify, on every platform", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup
      const left = yield* orphan(sessionID, { command: "bun run dev", process: { pid: 999_999_999, started: "" } })
      const settled = yield* (yield* Monitor.make).get(sessionID, left.id)
      expect(settled?.status).toBe("interrupted")
      if (Monitor.identifiable) {
        expect(settled?.cleanup).toBe("exited")
      } else {
        expect(settled?.cleanup).toBe("unknown")
        expect(settled?.error).toContain("999999999 (bun run dev) may still be running")
      }
    }),
  )

  it.live("reports the rest of a process group whose leader already exited", () =>
    Effect.gen(function* () {
      if (process.platform !== "linux") return
      const sessionID = yield* setup
      const leader = spawn("sh", ["-c", "sleep 30 & sleep 0.3"], { detached: true, stdio: "ignore" })
      const pid = leader.pid!
      try {
        const started = identity(pid)
        yield* Effect.promise(() => new Promise((resolve) => leader.once("exit", resolve)))
        const left = yield* orphan(sessionID, { command: "./serve.sh", process: { pid, started } })
        const settled = yield* (yield* Monitor.make).get(sessionID, left.id)
        expect(settled?.cleanup).toBe("left-running")
        expect(settled?.error).toContain(`The leader of process group ${pid} (./serve.sh) exited`)
      } finally {
        try {
          process.kill(-pid, "SIGKILL")
        } catch {}
      }
    }),
  )

  it.live("a verified-live owner keeps its monitor past the deadline, and its process group is never touched", () =>
    Effect.gen(function* () {
      if (!Monitor.identifiable) return
      const sessionID = yield* setup
      // The owner's runtime and the monitor's command, both alive; this clock jumped past the deadline.
      const runtime = group()
      const command = group()
      try {
        const owner = `${runtime.pid}:${Buffer.from(identity(runtime.pid!)).toString("base64url")}:stand-in`
        expect(Monitor.ownerStatus(owner)).toBe("alive")
        const jumped = yield* orphan(
          sessionID,
          { created: Date.now() - 2 * 3_600_000, process: { pid: command.pid!, started: identity(command.pid!) } },
          owner,
        )
        const monitors = yield* Monitor.make
        expect((yield* monitors.get(sessionID, jumped.id))?.status).toBe("running")
        expect((yield* monitors.list(sessionID)).map((info) => info.status)).toEqual(["running"])
        expect(exited(command.pid!)).toBe(false)
      } finally {
        stop(runtime)
        stop(command)
      }
    }),
  )

  it.live("a dead owner past its deadline is interrupted", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup
      expect(Monitor.ownerStatus(GONE)).toBe("dead")
      const left = yield* orphan(sessionID, { created: Date.now() - 2 * 3_600_000 })
      const settled = yield* (yield* Monitor.make).get(sessionID, left.id)
      expect(settled).toMatchObject({ status: "interrupted", delivery: "suppressed" })
      expect(settled?.error).toContain("Execution ownership was lost")
    }),
  )

  it.live("an owner whose identity cannot be verified expires at the deadline without killing anything", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup
      // No start time in the owner, as on Windows: the pid exists, but it may be anyone's now.
      const runtime = group()
      const command = group()
      try {
        const owner = `${runtime.pid}::stand-in`
        expect(Monitor.ownerStatus(owner)).toBe("unverified")
        const started = Monitor.identifiable ? identity(command.pid!) : ""
        const fresh = yield* orphan(sessionID, { created: Date.now() }, owner)
        const stale = yield* orphan(
          sessionID,
          { created: Date.now() - 2 * 3_600_000, command: "pnpm build", process: { pid: command.pid!, started } },
          owner,
        )
        const monitors = yield* Monitor.make
        expect((yield* monitors.get(sessionID, fresh.id))?.status).toBe("running")
        const expiredRow = yield* monitors.get(sessionID, stale.id)
        expect(expiredRow?.status).toBe("interrupted")
        expect(expiredRow?.error).toContain("its owner could not be verified")
        expect(expiredRow?.cleanup).not.toBe("reaped")
        expect(expiredRow?.error).toContain(`${command.pid} (pnpm build)`)
        expect(exited(command.pid!)).toBe(false)
      } finally {
        stop(runtime)
        stop(command)
      }
    }),
  )

  it.live("a failed ps or pgrep is no answer: not cached, not dead, and recovery keeps going", () =>
    Effect.sync(() => {
      const original = Monitor.probe.spawn
      let calls = 0
      Monitor.probe.spawn = () => {
        calls++
        return {
          pid: 0,
          output: [],
          stdout: null as unknown as string,
          stderr: null as unknown as string,
          status: null,
          signal: null,
          error: new Error("spawn EAGAIN"),
        }
      }
      try {
        expect(Monitor.processInfo(4_242_424, "darwin")).toBe("unknown")
        expect(Monitor.processInfo(4_242_424, "darwin")).toBe("unknown")
        // Failures are asked again rather than remembered.
        expect(calls).toBe(2)
        expect(Monitor.groupMembers(4_242_424, "darwin")).toBeUndefined()
        expect(calls).toBe(3)
      } finally {
        Monitor.probe.spawn = original
      }
    }),
  )
})
