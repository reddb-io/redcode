import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Scope } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Monitor } from "../src/monitor"
import { Database } from "../src/database/database"
import { BackgroundJob } from "../src/background-job"
import { AppProcess } from "../src/process"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { SessionSchema } from "../src/session/schema"
import { AbsolutePath } from "../src/schema"
import { testEffect } from "./lib/effect"

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
        run: Effect.scoped(
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
      expect(process.kill(pid, 0)).toBe(true)
      expect((yield* monitors.cancel(sessionID, info.id))?.status).toBe("cancelled")
      expect(() => process.kill(pid, 0)).toThrow()
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
          run: Effect.succeed(evidence),
        })
      }
      const fourth = yield* monitors
        .start({ ...base, sessionID, originMessageID: "human-one", autonomous: true, run: Effect.succeed(evidence) })
        .pipe(Effect.exit)
      expect(Exit.isFailure(fourth)).toBe(true)
      expect(
        (yield* monitors.start({ ...base, sessionID, originMessageID: "human-two", run: Effect.succeed(evidence) }))
          .status,
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
        run: Effect.succeed({ ...evidence, exit: null, timedOut: true }),
      })
      expect(timed.status).toBe("timed_out")
      const failed = yield* monitors.start({
        ...base,
        sessionID,
        options: { mode: "poll", success_contains: "ready", failure_contains: "failed" },
        run: Effect.succeed({ ...evidence, output: "ready failed" }),
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
        run: Effect.sync(() => starts++).pipe(
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
        evidence: { output: "ready\n" },
      })
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
        run: Deferred.await(release).pipe(Effect.as(evidence)),
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
        run: Effect.scoped(
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
        run: Effect.sync(() => ({ ...evidence, exit: ++attempts < 3 ? 1 : 0 })),
      })
      expect(result).toMatchObject({ status: "succeeded", attempts: 3 })
      const failed = yield* monitors.start({
        ...base,
        sessionID: yield* setup,
        run: Effect.succeed({ ...evidence, exit: 2 }),
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
        run: Effect.never,
      })
      expect(result.status).toBe("timed_out")
    }),
  )

  it.live("keeps durable evidence after replacing the runtime and never replays a command", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup
      const scope = yield* Scope.make()
      const background = yield* BackgroundJob.make.pipe(Scope.provide(scope))
      const first = yield* Monitor.make.pipe(
        Effect.provideService(BackgroundJob.Service, background),
        Scope.provide(scope),
      )
      const info = yield* first.start({ ...base, sessionID, options: { mode: "once", wait_ms: 0 }, run: Effect.never })
      const second = yield* Monitor.make
      expect((yield* second.get(sessionID, info.id))?.status).toBe("interrupted")
      yield* Scope.close(scope, Exit.void)
      expect((yield* first.get(sessionID, info.id))?.status).toBe("cancelled")
    }),
  )
})
