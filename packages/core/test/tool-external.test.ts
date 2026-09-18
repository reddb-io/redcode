import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ExternalTools } from "../src/tool/external"
import { PermissionV2 } from "../src/permission"
import { ToolRegistry } from "../src/tool/registry"
import { ToolOutputStore } from "../src/tool-output-store"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { SessionV2 } from "../src/session"
import { SessionMessage } from "../src/session/message"
import { AgentV2 } from "../src/agent"
import { executeTool, toolDefinitions } from "./lib/tool"
import { testEffect } from "./lib/effect"

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
    rules: () => Effect.die("unused"),
  }),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ExternalTools.node, ToolRegistry.node, ToolRegistry.toolsNode]), [
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    [PermissionV2.node, permission],
  ]),
)

const sessionID = SessionV2.ID.make("ses_external_tool")
const agent = AgentV2.ID.make("build")
const assistantMessageID = SessionMessage.ID.make("msg_external_tool")

const echo = async (input: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(input) }],
})

describe("ExternalTools", () => {
  it.effect("registers a tool whose input schema declares draft 2020-12", () =>
    Effect.gen(function* () {
      const external = yield* ExternalTools.Service
      const registry = yield* ToolRegistry.Service
      yield* external.register({
        schema_2020: {
          description: "Echoes input",
          inputSchema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
          execute: echo,
        },
      })
      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["schema_2020"])
      expect(
        yield* executeTool(registry, {
          sessionID,
          agent,
          assistantMessageID,
          call: { type: "tool-call", id: "call-2020", name: "schema_2020", input: { query: "hello" } },
        }),
      ).toEqual({ type: "text", value: JSON.stringify({ query: "hello" }) })
    }),
  )

  it.effect("registers a tool whose input schema declares the 2020-1 URI variant", () =>
    Effect.gen(function* () {
      const external = yield* ExternalTools.Service
      const registry = yield* ToolRegistry.Service
      yield* external.register({
        schema_2020_1: {
          description: "Echoes input",
          inputSchema: {
            $schema: "https://json-schema.org/draft/2020-1/schema",
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
          execute: echo,
        },
      })
      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["schema_2020_1"])
      expect(
        yield* executeTool(registry, {
          sessionID,
          agent,
          assistantMessageID,
          call: { type: "tool-call", id: "call-2020-1", name: "schema_2020_1", input: { query: "hi" } },
        }),
      ).toEqual({ type: "text", value: JSON.stringify({ query: "hi" }) })
    }),
  )

  it.effect("validates arguments against the 2020-12 schema's keywords", () =>
    Effect.gen(function* () {
      const external = yield* ExternalTools.Service
      const registry = yield* ToolRegistry.Service
      let invoked = false
      yield* external.register({
        schema_2020_required: {
          description: "Echoes input",
          inputSchema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
          execute: async () => {
            invoked = true
            return { content: [] }
          },
        },
      })
      const settlement = yield* executeTool(registry, {
        sessionID,
        agent,
        assistantMessageID,
        call: { type: "tool-call", id: "call-invalid", name: "schema_2020_required", input: {} },
      })
      expect(settlement.type).toBe("error")
      expect(invoked).toBe(false)
    }),
  )

  it.effect("skips a tool with an uncompilable schema without failing the registration", () =>
    Effect.gen(function* () {
      const external = yield* ExternalTools.Service
      const registry = yield* ToolRegistry.Service
      yield* external.register({
        broken_schema: {
          description: "Dangling reference",
          inputSchema: {
            type: "object",
            properties: { query: { $ref: "#/definitions/missing" } },
          },
          execute: echo,
        },
        working: {
          description: "Echoes input",
          inputSchema: { type: "object" },
          execute: echo,
        },
      })
      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["working"])
    }),
  )
})
