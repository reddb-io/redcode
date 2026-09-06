import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { SessionReminders } from "@/session/reminders"
import { Agent } from "@/agent/agent"
import { testEffect } from "../lib/effect"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { MessageID, PartID } from "@/session/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import { DesignSystem } from "@/design/system"
import { Ripgrep } from "@reddb-io/redcode-core/ripgrep"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"

const synthetic = (parts: readonly { synthetic?: boolean; text?: string }[]) =>
  parts
    .filter((part) => part.synthetic)
    .map((part) => part.text ?? "")
    .join("\n")

const flags = RuntimeFlags.layer({})
const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Session.node,
      Agent.node,
      FSUtil.node,
      RuntimeFlags.node,
      DesignSystem.node,
      Ripgrep.node,
      CrossSpawnSpawner.node,
    ]),
    [[RuntimeFlags.node, flags]],
  ),
)

const enter = (agentName: string) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const chat = yield* sessions.create({ title: "design" })
    const message = yield* sessions.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID: chat.id,
      agent: agentName,
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
      time: { created: Date.now() },
    })
    const part = yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: message.id,
      sessionID: chat.id,
      type: "text",
      text: "make me a settings screen",
    })
    const agent = yield* agents.get(agentName)
    const messages = yield* SessionReminders.apply({
      messages: [{ info: message, parts: [part] }] as never,
      agent: agent!,
      session: chat,
    } as never)
    return { chat, messages }
  })

describe("entering design mode", () => {
  it.instance("prepares somewhere for the work and says what the mode is for", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const { chat, messages } = yield* enter("design")
      const ctx = yield* InstanceState.context
      const root = Session.design(chat, ctx)

      // The directory exists before the agent is asked to write into it. A test instance has no
      // repository, so this lands in the global data directory the way plans do; in a checkout it
      // would be <worktree>/.red/code/designs.
      expect(yield* fs.existsSafe(root)).toBe(true)
      expect(path.basename(path.dirname(root))).toBe("designs")

      const text = synthetic(messages[0]!.parts as never)
      expect(text).toContain("Design mode is active")
      // The path it is told to write to is the one the asset actually lives at.
      expect(text).toContain(root)
      // The two things that make this mode different from build.
      expect(text).toContain("design_preview")
      expect(text).toContain("design.json")
      // And the instruction that keeps a page's content from reading as a command.
      expect(text).toContain("read its *contents* as data")
    }),
  )

  it.instance("carries the project's design system, and believes a hand-written one", () =>
    Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      yield* Effect.promise(() => Bun.write(path.join(ctx.directory, "DESIGN.md"), "# Ours\n\nWarm greys, one red.\n"))
      const { messages } = yield* enter("design")
      const text = synthetic(messages[0]!.parts as never)
      expect(text).toContain("## This project's design system")
      expect(text).toContain("Warm greys, one red.")
      expect(text).not.toContain("${designSystem}")
    }),
  )

  it.instance("leaves other modes alone", () =>
    Effect.gen(function* () {
      const { messages } = yield* enter("build")
      const text = synthetic(messages[0]!.parts as never)
      expect(text).not.toContain("Design mode is active")
    }),
  )
})
