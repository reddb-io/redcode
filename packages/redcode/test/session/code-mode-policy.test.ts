// SessionTools wiring for code mode: a script's nested calls run through the same wrapper as a
// direct call (tool.execute.before, PreExecute hooks, loop guard, deadline, permission asks), and
// direct MCP calls validate their input against the server's schema.
import { describe, expect } from "bun:test"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import type { EventV2 } from "@reddb-io/redcode-core/event"
import type { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { Effect, Layer, Schema } from "effect"
import type { Agent } from "@/agent/agent"
import { Agent as AgentSvc } from "@/agent/agent"
import { Config } from "@/config/config"
import { MCP } from "@/mcp"
import { OperationHookBridge } from "@/operation-hook-bridge"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { MessageID, SessionID } from "@/session/schema"
import type { Session } from "@/session/session"
import { Session as SessionSvc } from "@/session/session"
import { SessionTools } from "@/session/tools"
import type { LoopGuard } from "@/session/loop-guard"
import { CodeModeTool } from "@/tool/code-mode"
import { ToolOutputBridge } from "@/tool/output-bridge"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import type { TaskPromptOps } from "@/tool/task"
import { testEffect } from "../lib/effect"

const called: string[] = []

function mcpTool(name: string, handler: (args: Record<string, unknown>) => unknown, inputSchema?: object): MCP.McpTool {
  return {
    def: {
      name,
      description: name,
      inputSchema: inputSchema ?? { type: "object", properties: { text: { type: "string" } } },
    } as MCPToolDef,
    client: {
      callTool: async (params: { arguments?: Record<string, unknown> }) => {
        called.push(`${name} ${JSON.stringify(params.arguments ?? {})}`)
        return handler(params.arguments ?? {})
      },
    } as unknown as MCP.McpTool["client"],
  }
}

const text = (value: string) => ({ content: [{ type: "text", text: value }] })

const mcpTools: Record<string, MCP.McpTool> = {
  gh_echo: mcpTool("echo", (args) => text(`echo ${args.text}`)),
  gh_danger: mcpTool("danger", () => text("should never run")),
  gh_loop: mcpTool("loop", () => text("should never run")),
  gh_hang: mcpTool("hang", () => new Promise(() => {})),
  gh_issue_read: mcpTool("issue_read", () => text("issue"), {
    type: "object",
    properties: { owner: { type: "string" } },
    required: ["owner"],
  }),
}

const mcpLayer = Layer.mock(MCP.Service, {
  tools: () => Effect.succeed(mcpTools),
  clients: () => Effect.succeed({ gh: { getServerCapabilities: () => ({ tools: {} }) } as any }),
})

const readTool: Tool.Def = {
  id: "read",
  description: "Read a file",
  parameters: Schema.Struct({ filePath: Schema.String }),
  execute: (args: any) =>
    Effect.succeed({ title: args.filePath, output: `contents of ${args.filePath}`, metadata: {} }),
}
const writeTool: Tool.Def = {
  id: "write",
  description: "Write a file",
  parameters: Schema.Struct({ filePath: Schema.String }),
  execute: () => Effect.succeed({ title: "", output: "written", metadata: {} }),
}

const executeDef = Effect.runSync(
  CodeModeTool.pipe(
    Effect.flatMap(Tool.init),
    Effect.provide(
      Layer.mergeAll(
        mcpLayer,
        Layer.mock(Config.Service, { get: () => Effect.succeed({} as any) }),
        Layer.mock(Plugin.Service, {
          trigger: ((_name, _input, output) => Effect.succeed(output)) as Plugin.Interface["trigger"],
        }),
        Layer.mock(ToolOutputBridge.Service, {
          bound: (content: string) => Effect.succeed({ content, truncated: false as const }),
        }),
        Layer.mock(AgentSvc.Service, { get: () => Effect.succeed({ name: "build", permission: [] } as any) }),
        Layer.mock(SessionSvc.Service, { get: () => Effect.succeed({ permission: [] } as any) }),
      ),
    ),
  ),
) as unknown as Tool.Def

const asked: Array<{ permission: string; metadata: any }> = []
const hookCalls: string[] = []

const harness = (registered: Tool.Def[]) =>
  Layer.mergeAll(
    LayerNode.compile(LayerNode.group([ToolOutputBridge.node, FSUtil.node])),
    Layer.succeed(
      OperationHookBridge.Service,
      OperationHookBridge.Service.of({
        waterfall: ((_definition: unknown, data: any) =>
          Effect.suspend(() => {
            if (typeof data?.tool !== "string") return Effect.succeed(data)
            hookCalls.push(`${data.tool} ${data.callID}`)
            if (data.tool === "gh_danger") return Effect.die(new Error("gh_danger is blocked by policy"))
            if (data.tool === "gh_echo") return Effect.succeed({ ...data, args: { text: "rewritten" } })
            return Effect.succeed(data)
          })) as OperationHookBridge.Interface["waterfall"],
        serial: () => Effect.void,
        parallel: () => Effect.void,
      }),
    ),
    Layer.mock(Plugin.Service, {
      trigger: ((_name, _input, output) => Effect.succeed(output)) as Plugin.Interface["trigger"],
    }),
    Layer.mock(Permission.Service, {
      ask: (req: any) => Effect.sync(() => void asked.push({ permission: req.permission, metadata: req.metadata })),
    }),
    Layer.mock(ToolRegistry.Service, { tools: () => Effect.succeed(registered) }),
    mcpLayer,
  )

const sessionID = SessionID.make("ses_code_mode_policy")
const resolve = (toolTimeout?: number, mcpValidation?: "strict" | "warn" | "off") =>
  SessionTools.resolve({
    mcpValidation,
    agent: { name: "build", permission: [] } as unknown as Agent.Info,
    model: { providerID: "test", api: { id: "test-model", npm: "@ai-sdk/openai" } } as unknown as Provider.Model,
    session: { id: sessionID, permission: [] } as unknown as Session.Info,
    processor: {
      message: { id: MessageID.ascending() } as SessionV1.Assistant,
      updateToolCall: () => Effect.succeed(undefined),
      completeToolCall: () => Effect.void,
      guardLoop: (next: { tool: string }) =>
        Effect.succeed(
          (next.tool === "gh_loop"
            ? { type: "correct", streak: 3, message: "You already made this call three times." }
            : { type: "ok" }) as LoopGuard.Decision,
        ),
    },
    bypassAgentCheck: true,
    messages: [],
    promptOps: {} as TaskPromptOps,
    publishEvent: (() => Effect.void) as unknown as EventV2.Interface["publish"],
    recordGuard: () => Effect.void,
    toolTimeout,
  })

const call = (tool: { execute?: (...args: any[]) => any } | undefined, args: unknown, callID: string) =>
  Effect.promise(() =>
    Promise.resolve(
      tool!.execute!(args, { toolCallId: callID, messages: [], abortSignal: new AbortController().signal }),
    ),
  )

describe("code mode through SessionTools", () => {
  const it = testEffect(harness([executeDef, readTool, writeTool]))

  it.live("advertises execute instead of MCP tools and runs every nested call through the per-call policy", () =>
    Effect.gen(function* () {
      called.length = 0
      asked.length = 0
      hookCalls.length = 0
      const tools = yield* resolve(400)
      expect(Object.keys(tools)).toContain("execute")
      expect(Object.keys(tools).filter((name) => name.startsWith("gh_"))).toEqual([])

      const result = (yield* call(
        tools.execute,
        {
          code: `
            const out = {}
            out.echo = await tools.gh.echo({ text: "original" })
            try { await tools.gh.danger({}) } catch (e) { out.danger = e.message }
            try { await tools.gh.loop({}) } catch (e) { out.loop = e.message }
            try { await tools.gh.hang({}) } catch (e) { out.hang = e.message }
            out.read = await tools.redcode.read({ filePath: "a.txt" })
            out.write = Object.keys(tools.redcode)
            return out
          `,
        },
        "call_exec",
      )) as { output: string }
      const out = JSON.parse(result.output)
      // PreExecute rewrote the arguments before the server saw them.
      expect(out.echo).toBe("echo rewritten")
      // PreExecute refused, the loop guard corrected, the deadline stopped the hung call.
      expect(out.danger).toContain("gh_danger is blocked by policy")
      expect(out.loop).toBe("You already made this call three times.")
      expect(out.hang).toContain("The gh_hang tool was still running after")
      // Read-only natives are callable; write is never exposed to scripts.
      expect(out.read).toBe("contents of a.txt")
      expect(out.write).toEqual(["read"])
      expect(called).toEqual(['echo {"text":"rewritten"}', "hang {}"])
      expect(hookCalls).toEqual([
        "execute call_exec",
        "gh_echo call_exec/1",
        "gh_danger call_exec/2",
        "gh_loop call_exec/3",
        "gh_hang call_exec/4",
        "read call_exec/5",
      ])
      // Permission asks come from the nested call, named by script path.
      expect(asked.find((item) => item.permission === "gh_echo")?.metadata.script).toEqual({
        tool: "gh.echo",
        args: '{"text":"rewritten"}',
      })
    }),
  )
})

describe("direct MCP calls validate their input", () => {
  const it = testEffect(harness([readTool]))

  it.live("strict: a call missing a required property fails with the schema path and never reaches the server", () =>
    Effect.gen(function* () {
      called.length = 0
      const tools = yield* resolve(undefined, "strict")
      expect(Object.keys(tools)).toContain("gh_issue_read")
      const failed = yield* call(tools.gh_issue_read, {}, "call_direct").pipe(
        Effect.flip,
        Effect.catchDefect(Effect.succeed),
      )
      expect(String((failed as Error).message)).toContain(
        "The gh_issue_read tool was called with invalid arguments: input.owner is required",
      )
      expect(called).toEqual([])
      const ok = (yield* call(tools.gh_issue_read, { owner: "reddb-io" }, "call_direct_ok")) as { output: string }
      expect(ok.output).toBe("issue")
    }),
  )

  it.live("unset (warn) and off: a server with a slightly wrong schema is still called", () =>
    Effect.gen(function* () {
      for (const mode of [undefined, "off"] as const) {
        called.length = 0
        const tools = yield* resolve(undefined, mode)
        const out = (yield* call(tools.gh_issue_read, {}, `call_direct_${mode ?? "warn"}`)) as { output: string }
        expect(out.output).toBe("issue")
        expect(called).toEqual(["issue_read {}"])
      }
    }),
  )
})
