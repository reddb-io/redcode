import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { Question } from "@/question"
import { Provider } from "@/provider/provider"
import { DesignExitTool } from "@/tool/design"
import { DesignManifest } from "@/design/manifest"
import { Truncate } from "@/tool/truncate"
import { Agent } from "@/agent/agent"
import { Database } from "@reddb-io/redcode-core/database/database"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { testEffect } from "../lib/effect"

/** A person who says yes, without a TUI to say it in. */
const agreeable = Layer.succeed(
  Question.Service,
  Question.Service.of({ ask: () => Effect.succeed([["Yes"]]) } as never),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Session.node,
      SessionProjector.node,
      Database.node,
      Provider.node,
      FSUtil.node,
      Truncate.node,
      Agent.node,
      Question.node,
    ]),
    [
      [Question.node, agreeable],
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
    ],
  ),
)

describe("leaving design mode", () => {
  it.instance("writes the plan from what the design recorded, and links the two", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const fs = yield* FSUtil.Service
      const ctx = yield* InstanceState.context
      const chat = yield* sessions.create({ title: "settings screen" })

      // What a design session leaves behind: a prototype and its reasoning.
      const root = Session.design(chat, ctx)
      yield* fs.ensureDir(root)
      yield* Effect.promise(() => Bun.write(path.join(root, "index.html"), "<html></html>"))
      yield* Effect.promise(() =>
        Bun.write(
          DesignManifest.file(root),
          DesignManifest.serialize({
            ...DesignManifest.empty("settings screen"),
            decisions: ["one column on mobile"],
            questions: ["what happens with no results?"],
          }),
        ),
      )

      const tool = yield* (yield* DesignExitTool).init()
      const result = yield* tool.execute({}, {
        sessionID: chat.id,
        messageID: "msg_test",
        callID: "call_test",
        agent: "design",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
        extra: {},
      } as never)

      expect(result.title).toBe("Switching to plan agent")

      // The plan carries the reasoning, not the markup.
      const planFile = Session.plan(chat, ctx)
      const plan = yield* Effect.promise(() => Bun.file(planFile).text())
      expect(plan).toContain("# settings screen")
      expect(plan).toContain("- one column on mobile")
      expect(plan).toContain("- what happens with no results?")
      expect(plan).toContain(path.relative(ctx.worktree, root))

      // And the design now knows which plan it became.
      const manifest = DesignManifest.parse(yield* Effect.promise(() => Bun.file(DesignManifest.file(root)).text()), "x")
      expect(manifest.plan).toBe(path.relative(ctx.worktree, planFile))

      // The hand-off itself: a user message addressed to the plan agent.
      const messages = yield* sessions.messages({ sessionID: chat.id })
      const last = messages.at(-1)
      expect(last?.info.role === "user" && last.info.agent).toBe("plan")
    }),
  )

  it.instance("does not overwrite a plan that already exists", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const fs = yield* FSUtil.Service
      const ctx = yield* InstanceState.context
      const chat = yield* sessions.create({ title: "kept" })
      const planFile = Session.plan(chat, ctx)
      yield* fs.ensureDir(path.dirname(planFile))
      yield* Effect.promise(() => Bun.write(planFile, "# hand-written\n"))
      yield* fs.ensureDir(Session.design(chat, ctx))

      const tool = yield* (yield* DesignExitTool).init()
      yield* tool.execute({}, {
        sessionID: chat.id,
        messageID: "msg_test",
        callID: "call_test",
        agent: "design",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
        extra: {},
      } as never)

      expect(yield* Effect.promise(() => Bun.file(planFile).text())).toBe("# hand-written\n")
    }),
  )
})
