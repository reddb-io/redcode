import { describe, expect } from "bun:test"
import { DateTime, Effect, Exit, Layer, Schema } from "effect"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Permission } from "@opencode/core/permission"
import { Agent } from "@opencode/core/agent"
import { Tool } from "@opencode/core/tool"
import { Image } from "@opencode/core/image"
import { Location } from "@opencode/core/location"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { SessionHistoryTool } from "@opencode/core/tool/plugin/session-history"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const current = Session.ID.make("ses_current")
const target = Session.ID.make("ses_reference")
const user = SessionMessage.User.make({ id: SessionMessage.ID.make("msg_user"), type: "user", text: "x".repeat(4500), time: { created: DateTime.makeUnsafe(0) } })
const assistant = Schema.decodeUnknownSync(SessionMessage.Assistant)({
  id: "msg_assistant", type: "assistant", agent: "build", model: { providerID: "test", id: "model" },
  content: [{ type: "text", text: "A useful answer" }, { type: "reasoning", text: "hidden reasoning" }], time: { created: 1 },
})
const asked: Permission.AssertInput[] = []
const reads: unknown[] = []
let denied = false
const node = makeLocationNode({
  name: "test/session-reference",
  layer: Layer.effectDiscard(Effect.gen(function* () { yield* registerToolPlugin(SessionHistoryTool.Plugin) })),
  deps: [Tool.node, Permission.node, Session.node],
})
const fixture = testEffect(AppNodeBuilder.build(LayerNode.group([Tool.node, node]), [
  Location.node.replace(tempLocationLayer),
  Image.node.replace(imagePassthrough),
  Permission.node.replace(permissionLayer({ assert: (input) => Effect.sync(() => { asked.push(input); if (denied) throw new Permission.BlockedError({ permission: input.action, resources: input.resources, rules: [] }) }) })),
  Session.node.replace(Layer.mock(Session.Service, {
    messages: (input) => Effect.sync(() => { reads.push(input); return input.cursor ? [user] : [assistant, user] }),
    message: (input) => Effect.sync(() => { reads.push(input); return input.sessionID === target && input.messageID === user.id ? user : undefined }),
    revert: { stage: () => Effect.die("unused"), clear: () => Effect.die("unused"), commit: () => Effect.die("unused") },
  })),
]))
const call = (input: unknown) => ({ sessionID: current, ...toolIdentity, call: { type: "tool-call" as const, id: "call_history", name: "session_history", input } })

describe("reading a referenced conversation", () => {
  fixture.effect("asks for a specific conversation under the default Build policy", () => Effect.sync(() => {
    const rule = Permission.evaluate("session_reference", target, Agent.Info.default(Agent.ID.make("build")).permissions)
    expect(rule.effect).toBe("ask")
  }))
  fixture.effect("requires access to the target and pages only user and assistant text", () => Effect.gen(function* () {
    asked.length = 0
    reads.length = 0
    const tools = yield* Tool.Service
    const result = yield* executeTool(tools, call({ sessionID: target, limit: 1 }))
    expect(result.status).toBe("completed")
    expect(asked).toMatchObject([{ action: "session_reference", resources: [target], save: [target], sessionID: current }])
    expect(JSON.parse(result.output)).toMatchObject({ sessionID: target, messages: [{ id: "msg_assistant", text: "A useful answer" }], nextBefore: "msg_assistant" })
    expect(result.output).not.toContain("hidden reasoning")
    const next = yield* executeTool(tools, call({ sessionID: target, before: "msg_assistant", limit: 1 }))
    expect(JSON.parse(next.output).messages[0]).toMatchObject({ id: "msg_user", truncated: true })
    expect(reads[1]).toMatchObject({ sessionID: target, cursor: { id: "msg_assistant", direction: "next" } })
    const tail = yield* executeTool(tools, call({ sessionID: target, messageID: "msg_user", offset: 4000 }))
    expect(JSON.parse(tail.output).text).toHaveLength(500)
  }))
  fixture.effect("rejects ambiguous cross-session lookups before requesting access", () => Effect.gen(function* () {
    asked.length = 0
    const result = yield* executeTool(yield* Tool.Service, call({ sessionID: target, toolCallID: "secret" }))
    expect(result.status).toBe("error")
    expect(asked).toEqual([])
  }))
  fixture.effect("does not read another conversation when access is denied", () => Effect.gen(function* () {
    denied = true
    reads.length = 0
    const result = yield* executeTool(yield* Tool.Service, call({ sessionID: target })).pipe(Effect.exit)
    denied = false
    expect(Exit.isFailure(result)).toBe(true)
    expect(reads).toEqual([])
  }))
})
