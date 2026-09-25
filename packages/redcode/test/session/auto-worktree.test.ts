import { describe, expect } from "bun:test"
import path from "path"
import { existsSync } from "fs"
import { Effect, Exit, Layer } from "effect"
import { RepositoryGuard } from "@reddb-io/redcode-core/repository-guard"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Session } from "@/session/session"
import { AutoWorktree } from "@/session/auto-worktree"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Session.node,
      Config.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
    ]),
    [
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      [
        InstanceBootstrap.node,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

describe("session auto worktree", () => {
  it.instance(
    "moves the session tree into a worktree named after the root session",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const sessions = yield* Session.Service
        const events = yield* EventV2Bridge.Service
        const parent = yield* sessions.create({ title: "Fix the setup flow, please" })
        const child = yield* sessions.create({ parentID: parent.id })
        const worktree = path.join(test.directory, ".red", "worktrees", "fix-setup-flow")

        expect(yield* AutoWorktree.ensure({ sessions, events, sessionID: parent.id, agent: "plan" })).toBeUndefined()
        expect(yield* Effect.promise(() => Bun.file(path.join(worktree, ".git")).exists())).toBe(false)

        const claim = yield* AutoWorktree.ensure({ sessions, events, sessionID: child.id, agent: "general" })
        expect(claim).toMatchObject({ worktree, branch: "fix-setup-flow", created: true })
        expect((yield* sessions.get(parent.id)).directory).toBe(worktree)
        expect((yield* sessions.get(child.id)).directory).toBe(worktree)

        const again = yield* AutoWorktree.ensure({ sessions, events, sessionID: parent.id, agent: "build" })
        expect(again).toMatchObject({ worktree, created: false })
      }),
    { git: true },
  )

  it.instance("leaves a non-Git directory alone", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessions = yield* Session.Service
      const events = yield* EventV2Bridge.Service
      const session = yield* sessions.create({ title: "Fix the setup flow" })
      expect(yield* AutoWorktree.ensure({ sessions, events, sessionID: session.id, agent: "build" })).toBeUndefined()
      const target = path.join(test.directory, "file.txt")
      expect(yield* AutoWorktree.route({ sessions, events, sessionID: session.id, agent: "build" }, target)).toBe(
        target,
      )
      expect((yield* sessions.get(session.id)).directory).toBe(test.directory)
    }),
  )

  it.instance(
    "moves a YOLO session into its worktree on the first write and keeps primary changes in place",
    () =>
      withEnv(
        { REDCODE_YOLO: "1", REDCODE_AUTO_WORKTREE: undefined },
        Effect.gen(function* () {
          const test = yield* TestInstance
          const input = yield* writer("Fix the setup flow")
          yield* Effect.promise(() => Bun.write(path.join(test.directory, "draft.txt"), "user draft"))
          const worktree = path.join(test.directory, ".red", "worktrees", "fix-setup-flow")

          const target = yield* AutoWorktree.route(input, path.join(test.directory, "src", "new.txt"))
          expect(target).toBe(path.join(worktree, "src", "new.txt"))
          expect((yield* input.sessions.get(input.sessionID)).directory).toBe(worktree)
          expect(yield* Effect.promise(() => Bun.file(path.join(worktree, ".git")).exists())).toBe(true)
          expect(yield* Effect.promise(() => Bun.file(path.join(worktree, "draft.txt")).exists())).toBe(false)
          expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "draft.txt")).text())).toBe(
            "user draft",
          )
        }),
      ),
    { git: true },
  )

  it.instance(
    "runs a command the guard would refuse outside YOLO in the worktree instead of the primary checkout",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const refused = yield* RepositoryGuard.assertShell(test.directory, "mkdir build").pipe(Effect.exit)
        expect(Exit.isFailure(refused)).toBe(true)

        yield* withEnv(
          { REDCODE_YOLO: "1", REDCODE_AUTO_WORKTREE: undefined },
          Effect.gen(function* () {
            const input = yield* writer("Fix the setup flow")
            const worktree = path.join(test.directory, ".red", "worktrees", "fix-setup-flow")
            expect(yield* AutoWorktree.workdir(input, test.directory, "git status --short")).toBe(test.directory)
            expect(yield* AutoWorktree.workdir(input, test.directory, "mkdir build")).toBe(worktree)
            expect(yield* AutoWorktree.workdir(input, test.directory, "git stash")).toBe(worktree)
            expect((yield* input.sessions.get(input.sessionID)).directory).toBe(worktree)
          }),
        )
      }),
    { git: true },
  )

  it.instance(
    "keeps a YOLO session in the primary checkout with worktree.auto set to false",
    () =>
      withEnv(
        { REDCODE_YOLO: "1", REDCODE_AUTO_WORKTREE: undefined },
        Effect.gen(function* () {
          const test = yield* TestInstance
          const input = yield* writer("Fix the setup flow")
          const target = path.join(test.directory, "file.txt")
          expect(yield* AutoWorktree.route(input, target)).toBe(target)
          expect((yield* input.sessions.get(input.sessionID)).directory).toBe(test.directory)
          expect(existsSync(path.join(test.directory, ".red", "worktrees"))).toBe(false)
        }),
      ),
    { git: true, config: { worktree: { auto: false } } },
  )

  it.instance(
    "keeps a YOLO session in the primary checkout with REDCODE_AUTO_WORKTREE=0",
    () =>
      withEnv(
        { REDCODE_YOLO: "1", REDCODE_AUTO_WORKTREE: "0" },
        Effect.gen(function* () {
          const test = yield* TestInstance
          const input = yield* writer("Fix the setup flow")
          const target = path.join(test.directory, "file.txt")
          expect(yield* AutoWorktree.route(input, target)).toBe(target)
          expect(yield* AutoWorktree.workdir(input, test.directory, "mkdir build")).toBe(test.directory)
          expect((yield* input.sessions.get(input.sessionID)).directory).toBe(test.directory)
        }),
      ),
    { git: true },
  )

  it.instance(
    "gives no worktree to a YOLO plan session",
    () =>
      withEnv(
        { REDCODE_YOLO: "1", REDCODE_AUTO_WORKTREE: undefined },
        Effect.gen(function* () {
          const test = yield* TestInstance
          const input = { ...(yield* writer("Plan the setup flow")), agent: "plan" }
          const target = path.join(test.directory, "plan.md")
          expect(yield* AutoWorktree.route(input, target)).toBe(target)
          expect(yield* AutoWorktree.ensure(input)).toBeUndefined()
          expect((yield* input.sessions.get(input.sessionID)).directory).toBe(test.directory)
        }),
      ),
    { git: true },
  )

  it.instance("leaves a non-Git directory alone in YOLO mode", () =>
    withEnv(
      { REDCODE_YOLO: "1", REDCODE_AUTO_WORKTREE: undefined },
      Effect.gen(function* () {
        const test = yield* TestInstance
        const input = yield* writer("Fix the setup flow")
        const target = path.join(test.directory, "file.txt")
        expect(yield* AutoWorktree.route(input, target)).toBe(target)
        expect(yield* AutoWorktree.workdir(input, test.directory, "mkdir build")).toBe(test.directory)
        expect((yield* input.sessions.get(input.sessionID)).directory).toBe(test.directory)
      }),
    ),
  )
})

/** A build session with the instance's config, as the write, edit, patch and shell tools pass it. */
const writer = Effect.fn("AutoWorktreeTest.writer")(function* (title: string) {
  const sessions = yield* Session.Service
  const session = yield* sessions.create({ title })
  return {
    sessions,
    events: yield* EventV2Bridge.Service,
    config: yield* Config.Service,
    sessionID: session.id,
    agent: "build",
  }
})

/** Runs `body` with the given environment variables set (or removed when undefined), then restores them. */
const withEnv = <A, E, R>(values: Record<string, string | undefined>, body: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
      apply(values)
      return previous
    }),
    () => body,
    (previous) => Effect.sync(() => apply(previous)),
  )

const apply = (values: Record<string, string | undefined>) =>
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  })
