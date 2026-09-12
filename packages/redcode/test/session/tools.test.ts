import { describe, expect } from "bun:test"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import type { EventV2 } from "@reddb-io/redcode-core/event"
import type { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { Effect, Layer } from "effect"
import type { Agent } from "@/agent/agent"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MCP } from "@/mcp"
import { OperationHookBridge } from "@/operation-hook-bridge"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { MessageID, SessionID } from "@/session/schema"
import type { Session } from "@/session/session"
import { SessionTools } from "@/session/tools"
import { ToolOutputBridge } from "@/tool/output-bridge"
import { ToolRegistry } from "@/tool/registry"
import type { TaskPromptOps } from "@/tool/task"
import { testEffect } from "../lib/effect"

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

function mcpTool(name: string, result: unknown): MCP.McpTool {
  return {
    def: { name, description: name, inputSchema: { type: "object", properties: {} } } as MCPToolDef,
    client: { callTool: async () => result } as unknown as MCP.McpTool["client"],
  }
}

const harness = (mcpTools: Record<string, MCP.McpTool>) =>
  Layer.mergeAll(
    LayerNode.compile(LayerNode.group([ToolOutputBridge.node, FSUtil.node])),
    RuntimeFlags.layer(),
    OperationHookBridge.passthroughLayer,
    Layer.mock(Plugin.Service, {
      trigger: ((_name, _input, output) => Effect.succeed(output)) as Plugin.Interface["trigger"],
    }),
    Layer.mock(Permission.Service, { ask: () => Effect.void }),
    Layer.mock(ToolRegistry.Service, { tools: () => Effect.succeed([]) }),
    Layer.mock(MCP.Service, {
      tools: () => Effect.succeed(mcpTools),
      clients: () => Effect.succeed({}),
    }),
  )

const sessionID = SessionID.make("ses_session_tools")
const resolve = Effect.fn("SessionToolsTest.resolve")(function* () {
  return yield* SessionTools.resolve({
    agent: { name: "build", permission: [] } as unknown as Agent.Info,
    model: { providerID: "test", api: { id: "test-model", npm: "@ai-sdk/openai" } } as unknown as Provider.Model,
    session: { id: sessionID, permission: [] } as unknown as Session.Info,
    processor: {
      message: { id: MessageID.ascending() } as SessionV1.Assistant,
      updateToolCall: () => Effect.succeed(undefined),
      completeToolCall: () => Effect.void,
      guardLoop: () => Effect.succeed({ type: "ok" as const }),
    },
    bypassAgentCheck: true,
    messages: [],
    promptOps: {} as TaskPromptOps,
    publishEvent: (() => Effect.void) as unknown as EventV2.Interface["publish"],
    recordGuard: () => Effect.void,
  })
})

describe("SessionTools MCP tools", () => {
  const text = "x".repeat(ToolOutputBridge.MAX_BYTES + 1000)
  const it = testEffect(
    harness({
      pics_snapshot: mcpTool("snapshot", {
        content: [
          { type: "text", text },
          { type: "image", data: PNG, mimeType: "image/png" },
        ],
      }),
    }),
  )

  it.live("bounds only the text of an oversized MCP result and keeps its image attachment", () =>
    Effect.gen(function* () {
      const tools = yield* resolve()
      const tool = tools["pics_snapshot"]
      if (!tool?.execute) throw new Error("expected the MCP tool to be registered")
      const result = yield* Effect.promise(() =>
        Promise.resolve(
          tool.execute!({}, { toolCallId: "call_snapshot", messages: [], abortSignal: new AbortController().signal }),
        ),
      )
      const output = result as {
        output: string
        metadata: { truncated?: boolean; outputPath?: string }
        attachments: Array<{ mime: string; url: string }>
      }
      expect(output.metadata.truncated).toBe(true)
      if (typeof output.metadata.outputPath !== "string") throw new Error("expected a managed output path")
      expect(output.output).toContain(`full content saved to ${output.metadata.outputPath}`)
      expect(Buffer.byteLength(output.output, "utf-8")).toBeLessThanOrEqual(ToolOutputBridge.MAX_BYTES)
      expect(yield* (yield* FSUtil.Service).readFileString(output.metadata.outputPath)).toBe(text)
      expect(output.attachments).toHaveLength(1)
      expect(output.attachments[0]!.mime).toBe("image/png")
      expect(output.attachments[0]!.url).toBe(`data:image/png;base64,${PNG}`)
    }),
  )
})
