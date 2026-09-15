// Code mode through the legacy loop: fake OpenAI-compatible provider, in-memory MCP server.
import { DesignStudio } from "../../src/design/studio"
import { SessionPlan } from "@reddb-io/redcode-core/session/plan"
import { Database } from "@reddb-io/redcode-core/database/database"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { EventV2Bridge } from "@/event-v2-bridge"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "node:path"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { MonitorRuntime } from "@/background/monitor"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { McpCatalog } from "@/mcp/catalog"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionGuardLog } from "../../src/session/guard-log"
import { GoalRuntime } from "../../src/session/goal-runtime"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { ToolOutputBridge } from "@/tool/output-bridge"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import { Ripgrep } from "@reddb-io/redcode-core/ripgrep"
import { Format } from "../../src/format"
import { TestInstance } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LocationServiceMap } from "@reddb-io/redcode-core/location-services"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  CallToolRequestSchema,
  LATEST_PROTOCOL_VERSION,
  ListToolsRequestSchema,
  type Tool as MCPToolDef,
} from "@modelcontextprotocol/sdk/types.js"

const SERVER = "github"
const DEFS: MCPToolDef[] = [
  {
    name: "issue_read",
    description: "Read one issue",
    inputSchema: {
      type: "object",
      properties: { owner: { type: "string" }, repo: { type: "string" }, issue_number: { type: "number" } },
      required: ["owner", "repo", "issue_number"],
    },
  },
  {
    name: "list_issues",
    description: "List issues in a repository",
    inputSchema: { type: "object", properties: { owner: { type: "string" } }, required: ["owner"] },
  },
] as MCPToolDef[]

// Avoid the SDK Client here; other MCP tests mock it process-globally.
class RawJsonRpcClient {
  private nextId = 1
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  constructor(private transport: InMemoryTransport) {}
  async connect() {
    this.transport.onmessage = (message) => {
      const msg = message as { id?: number; result?: unknown; error?: { message: string } }
      if (msg.id === undefined) return
      const entry = this.pending.get(msg.id)
      if (!entry) return
      this.pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(msg.error.message))
      else entry.resolve(msg.result)
    }
    await this.transport.start()
    await this.request("initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "code-mode-loop", version: "1.0.0" },
    })
    await this.transport.send({ jsonrpc: "2.0", method: "notifications/initialized" })
  }
  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    void this.transport.send({ jsonrpc: "2.0", id, method, params } as never)
    return result
  }
  callTool(params: { name: string; arguments?: Record<string, unknown> }) {
    return this.request("tools/call", params)
  }
  getServerCapabilities() {
    return { tools: {} }
  }
}

const calls: string[] = []
let client: RawJsonRpcClient | undefined
const connect = Effect.promise(async () => {
  calls.length = 0
  if (client) return client
  const server = new Server({ name: SERVER, version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: DEFS }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    calls.push(`${req.params.name} ${JSON.stringify(req.params.arguments ?? {})}`)
    return { content: [{ type: "text", text: `issue #${(req.params.arguments as any)?.issue_number} is open` }] }
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  client = new RawJsonRpcClient(clientTransport)
  await client.connect()
  return client
})

const mcpTools = (): Record<string, MCP.McpTool> =>
  client
    ? Object.fromEntries(DEFS.map((def) => [McpCatalog.toolName(SERVER, def.name), { def, client: client as any }]))
    : {}

const mcpLayer = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.sync(() => (client ? { [SERVER]: client as any } : {})),
    instructions: () => Effect.succeed([]),
    tools: () => Effect.sync(mcpTools),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    reload: () => Effect.succeed({}),
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected"),
    authenticate: () => Effect.die("unexpected"),
    finishAuth: () => Effect.die("unexpected"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  } as any),
)

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)
const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)
const promptRoot = LayerNode.group([
  DesignStudio.node,
  SessionPlan.node,
  SessionPrompt.node,
  SessionGuardLog.node,
  GoalRuntime.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  LLM.node,
  Env.node,
  AgentSvc.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  ProviderSvc.node,
  LSP.node,
  MCP.node,
  FSUtil.node,
  BackgroundJob.node,
  MonitorRuntime.node,
  SessionStatus.node,
  SessionRunState.node,
  Database.node,
  EventV2Bridge.node,
  Question.node,
  Todo.node,
  ToolRegistry.node,
  Skill.node,
  Git.node,
  Ripgrep.node,
  Format.node,
  ToolOutputBridge.node,
  SessionProcessor.node,
  Image.node,
  SessionCompaction.node,
  SessionRevert.node,
  Instruction.node,
  SystemPrompt.node,
  CrossSpawnSpawner.node,
  RuntimeFlags.node,
  LocationServiceMap.node,
])
const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([promptRoot, testLLMServerNode]), [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, mcpLayer],
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true, experimentalBackgroundSubagents: true })],
  ] as const),
)

const cfg = (url: string, codeMode?: Record<string, unknown>) => ({
  $schema: "https://opencode.ai/config.json",
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 200000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: { apiKey: "test-key", baseURL: url },
    },
  },
  model: "test/test-model",
  // Everything allowed, so no permission prompt blocks the loop.
  permission: { "*": "allow" },
  ...(codeMode ? { experimental: { code_mode: codeMode } } : {}),
})

type Body = Record<string, any>
const toolNames = (body: Body): string[] => (body.tools ?? []).map((t: any) => t.function.name)

const setup = (codeMode?: Record<string, unknown>) =>
  Effect.gen(function* () {
    yield* connect
    const { directory } = yield* TestInstance
    const llm = yield* TestLLMServer
    const fsu = yield* FSUtil.Service
    yield* fsu.writeWithDirs(path.join(directory, "opencode.json"), JSON.stringify(cfg(llm.url, codeMode)))
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    const say = (value: string) =>
      prompt.prompt({ sessionID: chat.id, agent: "build", noReply: true, parts: [{ type: "text", text: value }] })
    const loop = () => awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "turn never finished", "60 seconds")
    const bodies = () =>
      llm.hits.pipe(
        Effect.map((hits) =>
          hits
            .map((hit) => hit.body as Body)
            .filter((body) => !JSON.stringify(body).includes("Generate a title for this conversation")),
        ),
      )
    const toolParts = () =>
      sessions
        .messages({ sessionID: chat.id })
        .pipe(Effect.map((msgs) => msgs.flatMap((m) => m.parts).filter((p) => p.type === "tool") as any[]))
    return { llm, say, loop, bodies, toolParts }
  })

describe("code mode in the legacy loop", () => {
  it.instance(
    "enabled in config, execute replaces MCP tools and a script calls the in-memory server",
    () =>
      Effect.gen(function* () {
        const s = yield* setup({ enabled: "on" })
        yield* s.say("is issue 7 open?")
        yield* s.llm.tool("execute", {
          code: "const text = await tools.github.issue_read({ owner: 'reddb-io', repo: 'redcode', issue_number: 7 }); return { text }",
        })
        yield* s.llm.text("yes")
        yield* s.loop()
        const [first] = yield* s.bodies()
        const names = toolNames(first!)
        expect(names).toContain("execute")
        expect(names.filter((name) => name.startsWith("github_"))).toEqual([])
        const execute = (first!.tools as any[]).find((tool) => tool.function.name === "execute")
        expect(execute.function.description).toContain("tools.github.issue_read(")
        expect(execute.function.description).toContain("tools.redcode.read(")
        const part = (yield* s.toolParts()).find((p) => p.tool === "execute")
        expect(part.state.status).toBe("completed")
        expect(JSON.parse(part.state.output)).toEqual({ text: "issue #7 is open" })
        expect(part.state.metadata.toolCalls).toEqual([
          {
            tool: "github.issue_read",
            status: "completed",
            input: { owner: "reddb-io", repo: "redcode", issue_number: 7 },
          },
        ])
        expect(calls).toEqual(['issue_read {"owner":"reddb-io","repo":"redcode","issue_number":7}'])
      }),
    60_000,
  )

  it.instance(
    "auto keeps MCP tools direct for a model outside the allowlist",
    () =>
      Effect.gen(function* () {
        const s = yield* setup({ enabled: "auto", models: ["anthropic/*"], threshold: 1 })
        yield* s.say("hello")
        yield* s.llm.text("hi")
        yield* s.loop()
        const [first] = yield* s.bodies()
        expect(toolNames(first!)).not.toContain("execute")
        expect(toolNames(first!)).toContain("github_issue_read")
      }),
    60_000,
  )

  it.instance(
    "auto turns code mode on for an allowlisted model above the threshold",
    () =>
      Effect.gen(function* () {
        const s = yield* setup({ enabled: "auto", models: ["test/*"], threshold: 1 })
        yield* s.say("hello")
        yield* s.llm.text("hi")
        yield* s.loop()
        const [first] = yield* s.bodies()
        expect(toolNames(first!)).toContain("execute")
        expect(toolNames(first!)).not.toContain("github_issue_read")
      }),
    60_000,
  )

  it.instance(
    "in direct mode an MCP call missing required input fails with the schema path and never reaches the server",
    () =>
      Effect.gen(function* () {
        const s = yield* setup()
        yield* s.say("read issue 7")
        yield* s.llm.tool("github_issue_read", { owner: "reddb-io" })
        yield* s.llm.text("sorry")
        yield* s.loop()
        const part = (yield* s.toolParts()).find((p) => p.tool === "github_issue_read")
        expect(part.state.status).toBe("error")
        expect(part.state.error).toContain("input.repo is required")
        expect(part.state.error).toContain("input.issue_number is required")
        expect(calls).toEqual([])
      }),
    60_000,
  )
})
