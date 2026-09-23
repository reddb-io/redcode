import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Session } from "@/session/session"
import { AutoWorktree } from "@/session/auto-worktree"
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
})
