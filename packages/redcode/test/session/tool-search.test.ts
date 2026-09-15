// tool_search through the legacy loop: fake OpenAI-compatible provider, in-memory MCP servers whose
// tool lists are the real tools/list output of popular servers (fixtures/mcp-schemas, trimmed to
// name, description and inputSchema).
import { DesignStudio } from "../../src/design/studio"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { SessionPlan } from "@reddb-io/redcode-core/session/plan"
import { Database } from "@reddb-io/redcode-core/database/database"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { EventV2Bridge } from "@/event-v2-bridge"
import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import fs from "node:fs"
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
import { ToolSearch } from "@/session/tool-search"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  CallToolRequestSchema,
  LATEST_PROTOCOL_VERSION,
  ListToolsRequestSchema,
  type Tool as MCPToolDef,
} from "@modelcontextprotocol/sdk/types.js"

const SERVERS = ["github", "linear", "slack", "filesystem", "playwright"] as const
const SCHEMAS = Object.fromEntries(
  SERVERS.map((name) => [
    name,
    JSON.parse(fs.readFileSync(path.join(import.meta.dir, "fixtures", "mcp-schemas", `${name}.json`), "utf8")),
  ]),
) as Record<string, MCPToolDef[]>

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
      clientInfo: { name: "tool-search", version: "1.0.0" },
    })
    await this.transport.send({ jsonrpc: "2.0", method: "notifications/initialized" })
  }
  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    void this.transport.send({ jsonrpc: "2.0", id, method, params } as never)
    return result
  }
  listTools() {
    return this.request("tools/list", {})
  }
  callTool(params: { name: string; arguments?: Record<string, unknown> }) {
    return this.request("tools/call", params)
  }
  getServerCapabilities() {
    return { tools: {} }
  }
}

type Srv = { name: string; defs: MCPToolDef[]; client: RawJsonRpcClient }
const connected = new Map<string, Srv>()
const calls: string[] = []
async function connect(name: string) {
  const existing = connected.get(name)
  if (existing) return existing
  const server = new Server({ name, version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: SCHEMAS[name] }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    calls.push(`${name}.${req.params.name}`)
    return { content: [{ type: "text", text: `ok ${name}.${req.params.name}` }] }
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new RawJsonRpcClient(clientTransport)
  await client.connect()
  const srv = { name, defs: (await client.listTools()).tools as MCPToolDef[], client }
  connected.set(name, srv)
  return srv
}

const active: { names: string[] } = { names: [] }
const useServers = (names: string[]) =>
  Effect.promise(async () => {
    for (const name of names) await connect(name)
    active.names = [...names]
    calls.length = 0
  })

const mcpTools = () => {
  const out: Record<string, MCP.McpTool> = {}
  for (const name of active.names) {
    const srv = connected.get(name)!
    for (const def of srv.defs) out[McpCatalog.toolName(name, def.name)] = { def, client: srv.client as any }
  }
  return out
}

const dynamicMcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () =>
      Effect.sync(() => Object.fromEntries(active.names.map((name) => [name, connected.get(name)!.client as any]))),
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
    [MCP.node, dynamicMcp],
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true, experimentalBackgroundSubagents: true })],
  ] as const),
)

const cfg = (url: string, extra: Record<string, unknown>) => ({
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
  ...extra,
})

const setup = (input: { agent?: string; extra?: Record<string, unknown> } = {}) =>
  Effect.gen(function* () {
    const { directory } = yield* TestInstance
    const llm = yield* TestLLMServer
    const fsu = yield* FSUtil.Service
    yield* fsu.writeWithDirs(path.join(directory, "opencode.json"), JSON.stringify(cfg(llm.url, input.extra ?? {})))
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    const agent = input.agent ?? "build"
    const say = (value: string) =>
      prompt.prompt({ sessionID: chat.id, agent, noReply: true, parts: [{ type: "text", text: value }] })
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
    return { llm, chat, say, loop, bodies, toolParts }
  })

type Body = Record<string, any>
const toolNames = (body: Body): string[] => (body.tools ?? []).map((t: any) => t.function.name)
const toolDef = (body: Body, name: string) => (body.tools ?? []).find((t: any) => t.function.name === name)
const systemText = (body: Body) =>
  (body.messages ?? [])
    .filter((m: any) => m.role === "system")
    .map((m: any) => m.content)
    .join("\n")
const mcpNames = () => Object.keys(mcpTools())

// Provider-cache order (tools -> system -> messages), as Anthropic/OpenAI prefix caches see it.
function preservedPrefix(a: Body, b: Body) {
  const canon = (body: Body) =>
    JSON.stringify(body.tools ?? []) +
    JSON.stringify((body.messages ?? []).filter((m: any) => m.role === "system")) +
    (body.messages ?? [])
      .filter((m: any) => m.role !== "system")
      .map((m: any) => JSON.stringify(m))
      .join("")
  const x = canon(a)
  const y = canon(b)
  let i = 0
  while (i < x.length && i < y.length && x[i] === y[i]) i++
  return i / x.length
}

describe("tool_search in the legacy loop", () => {
  it.instance(
    "under the threshold MCP tools stay advertised with their schemas",
    () =>
      Effect.gen(function* () {
        yield* useServers(["linear"])
        const s = yield* setup()
        yield* s.say("hello")
        yield* s.llm.text("hi")
        yield* s.loop()
        const [body] = yield* s.bodies()
        const names = toolNames(body)
        for (const name of mcpNames()) expect(names).toContain(name)
        // Design tools are still deferred for build without a Design context, but no MCP server is.
        expect(toolDef(body, "tool_search").function.description).not.toContain("linear (")
        expect(systemText(body)).not.toContain("tools for linear")
      }),
    60_000,
  )

  it.instance(
    "disabled, nothing is deferred and tool_search is absent",
    () =>
      Effect.gen(function* () {
        yield* useServers(["github"])
        const s = yield* setup({ extra: { experimental: { tool_search: { enabled: false } } } })
        yield* s.say("hello")
        yield* s.llm.text("hi")
        yield* s.loop()
        const [body] = yield* s.bodies()
        const names = toolNames(body)
        expect(names).not.toContain("tool_search")
        expect(names).toContain("github_issue_read")
        expect(names).toContain("design_document")
        expect(systemText(body)).not.toContain("tool_search")
      }),
    60_000,
  )

  it.instance(
    "over the threshold MCP schemas leave the request and the index and tool_search arrive",
    () =>
      Effect.gen(function* () {
        yield* useServers(["github", "slack"])
        const s = yield* setup()
        yield* s.say("hello")
        yield* s.llm.text("hi")
        yield* s.loop()
        const [body] = yield* s.bodies()
        const names = toolNames(body)
        expect(names.filter((name) => name.startsWith("github_") || name.startsWith("slack_"))).toEqual([])
        expect(JSON.stringify(body.tools)).not.toContain("issue_number")
        const description: string = toolDef(body, "tool_search").function.description
        expect(description).toContain("github (46): ")
        expect(description).toContain("issue_read")
        expect(description).toContain("slack (8): ")
        expect(systemText(body)).toContain(
          "Additional tools for design, github, slack are available through tool_search.",
        )
        // Native tools stay loaded.
        for (const name of ["read", "glob", "grep", "bash"]) expect(names).toContain(name)
      }),
    60_000,
  )

  it.instance(
    "a search loads its matches and the loaded tool is called on the next step",
    () =>
      Effect.gen(function* () {
        yield* useServers(["github"])
        const s = yield* setup()
        yield* s.say("read the comments on issue 7")
        yield* s.llm.tool("tool_search", { query: "read the comments on an issue" })
        yield* s.llm.tool("github_issue_read", {
          method: "get_comments",
          owner: "reddb-io",
          repo: "redcode",
          issue_number: 7,
        })
        yield* s.llm.text("done")
        yield* s.loop()
        const bodies = yield* s.bodies()
        expect(bodies.length).toBe(3)
        expect(toolNames(bodies[0])).not.toContain("github_issue_read")
        expect(toolNames(bodies[1])).toContain("github_issue_read")
        const parts = yield* s.toolParts()
        const search = parts.find((p) => p.tool === "tool_search")
        expect(search.state.status).toBe("completed")
        expect(search.state.metadata.loaded).toContain("github_issue_read")
        expect(search.state.output).toContain("github_issue_read — ")
        expect(search.state.output).toContain("params: ")
        expect(parts.find((p) => p.tool === "github_issue_read").state.status).toBe("completed")
        expect(calls).toEqual(["github.issue_read"])
      }),
    60_000,
  )

  it.instance(
    "select loads exact names and reports unknown ones with suggestions",
    () =>
      Effect.gen(function* () {
        yield* useServers(["github"])
        const s = yield* setup()
        yield* s.say("merge it")
        yield* s.llm.tool("tool_search", { select: ["github_merge_pull_request", "github_merge_pr", "read"] })
        yield* s.llm.text("ok")
        yield* s.loop()
        const bodies = yield* s.bodies()
        const loaded = toolNames(bodies[1]).filter((name) => name.startsWith("github_"))
        expect(loaded).toEqual(["github_merge_pull_request"])
        const search = (yield* s.toolParts()).find((p) => p.tool === "tool_search")
        expect(search.state.metadata.loaded).toEqual(["github_merge_pull_request"])
        expect(search.state.output).toContain("Unknown tool: github_merge_pr. Did you mean:")
        expect(search.state.output).toContain("Already available: read.")
      }),
    60_000,
  )

  it.instance(
    "calling a deferred tool that was never loaded runs it and keeps it loaded",
    () =>
      Effect.gen(function* () {
        yield* useServers(["github"])
        const s = yield* setup()
        yield* s.say("who am I")
        yield* s.llm.tool("github_get_me", {})
        yield* s.llm.text("you")
        yield* s.loop()
        const bodies = yield* s.bodies()
        expect(toolNames(bodies[0])).not.toContain("github_get_me")
        expect(toolNames(bodies[1])).toContain("github_get_me")
        const part = (yield* s.toolParts()).find((p) => p.tool === "github_get_me")
        expect(part.state.status).toBe("completed")
        expect(calls).toEqual(["github.get_me"])
      }),
    60_000,
  )

  it.instance(
    "the loaded set is append-only across turns and keeps most of the request prefix",
    () =>
      Effect.gen(function* () {
        yield* useServers(["github", "linear", "slack", "filesystem", "playwright"])
        const s = yield* setup()
        yield* s.say("first")
        yield* s.llm.tool("tool_search", { select: ["github_issue_read"] })
        yield* s.llm.text("loaded")
        yield* s.loop()
        yield* s.say("second")
        yield* s.llm.text("plain")
        yield* s.loop()
        yield* s.say("third")
        yield* s.llm.tool("tool_search", { select: ["slack_slack_post_message"] })
        yield* s.llm.text("loaded again")
        yield* s.loop()
        const bodies = yield* s.bodies()
        const loaded = bodies.map((body) => toolNames(body).filter((name) => mcpNames().includes(name)))
        expect(loaded).toEqual([
          [],
          ["github_issue_read"],
          ["github_issue_read"],
          ["github_issue_read"],
          ["github_issue_read", "slack_slack_post_message"],
        ])
        for (let i = 1; i < loaded.length; i++) for (const name of loaded[i - 1]) expect(loaded[i]).toContain(name)
        const description = toolDef(bodies[0], "tool_search").function.description
        for (const body of bodies) expect(toolDef(body, "tool_search").function.description).toBe(description)
        const prefix = bodies.slice(1).map((body, i) => preservedPrefix(bodies[i], body))
        // Steps that load nothing only append; steps that load a tool keep the tools that sort
        // before it. The ratios are printed for the PR's cache report.
        console.log("tool_search preserved prefix", prefix.map((p) => (p * 100).toFixed(1) + "%").join(" "))
        // The same requests with MCP tools moved after every other tool, as an append-friendly order
        // would send them; measured only, the order itself is not this change's to make.
        const mcpLast = (body: Body) => ({
          ...body,
          tools: [
            ...(body.tools ?? []).filter((t: any) => !mcpNames().includes(t.function.name)),
            ...(body.tools ?? []).filter((t: any) => mcpNames().includes(t.function.name)),
          ],
        })
        console.log(
          "tool_search preserved prefix with MCP tools last",
          bodies
            .slice(1)
            .map((body, i) => (preservedPrefix(mcpLast(bodies[i]), mcpLast(body)) * 100).toFixed(1) + "%")
            .join(" "),
        )
        expect(prefix[1]).toBeGreaterThan(0.95)
        expect(prefix[2]).toBeGreaterThan(0.95)
      }),
    60_000,
  )

  it.instance(
    "a loaded MCP tool still asks for permission",
    () =>
      Effect.gen(function* () {
        yield* useServers(["github"])
        const s = yield* setup({ extra: { permission: { github_issue_read: "ask" } } })
        const permission = yield* Permission.Service
        yield* s.say("read issue 7")
        yield* s.llm.tool("tool_search", { select: ["github_issue_read"] })
        yield* s.llm.tool("github_issue_read", { method: "get", owner: "reddb-io", repo: "redcode", issue_number: 7 })
        yield* s.llm.text("done")
        const asks: string[] = []
        const replier = yield* Effect.gen(function* () {
          const seen = new Set<string>()
          while (true) {
            for (const req of yield* permission.list()) {
              if (seen.has(req.id)) continue
              seen.add(req.id)
              asks.push(req.permission)
              yield* permission.reply({ requestID: req.id, reply: "once" }).pipe(Effect.ignore)
            }
            yield* Effect.sleep("20 millis")
          }
        }).pipe(Effect.forkChild)
        yield* s.loop()
        yield* Fiber.interrupt(replier)
        expect(asks).toEqual(["github_issue_read"])
        expect((yield* s.toolParts()).find((p) => p.tool === "github_issue_read").state.status).toBe("completed")
      }),
    60_000,
  )

  it.instance(
    "design tools are deferred for build without a Design context and loaded with one",
    () =>
      Effect.gen(function* () {
        yield* useServers([])
        const s = yield* setup()
        yield* s.say("hello")
        yield* s.llm.text("hi")
        yield* s.loop()
        const studio = yield* DesignStudio.Service
        yield* studio.use(
          DesignStore.Service.use((store) =>
            store.create(s.chat.id, { name: "Checkout", journey: "new", engine: "html", kind: "screen" }),
          ),
        )
        yield* s.say("implement the design")
        yield* s.llm.text("ok")
        yield* s.loop()
        const [before, after] = yield* s.bodies()
        expect(toolNames(before).filter((name) => name.startsWith("design_"))).toEqual([])
        expect(toolDef(before, "tool_search").function.description).toContain("design (")
        expect(systemText(before)).toContain("Additional tools for design are available through tool_search.")
        expect(toolNames(after)).toContain("design_document")
        expect(toolNames(after)).not.toContain("tool_search")
      }),
    60_000,
  )

  it.instance(
    "the design agent keeps its tools loaded",
    () =>
      Effect.gen(function* () {
        yield* useServers([])
        const s = yield* setup({ agent: "design" })
        yield* s.say("design checkout")
        yield* s.llm.text("ok")
        yield* s.loop()
        const [body] = yield* s.bodies()
        expect(toolNames(body)).toContain("design_document")
        expect(toolNames(body)).not.toContain("tool_search")
      }),
    60_000,
  )
})

describe("tool_search ranking", () => {
  const entries: ToolSearch.Entry[] = SERVERS.flatMap((server) =>
    SCHEMAS[server].map((def) => ({
      name: McpCatalog.toolName(server, def.name),
      namespace: server,
      description: def.description ?? "",
      schema: def.inputSchema as Record<string, unknown>,
    })),
  )
  const QUERIES: Array<[string, string]> = [
    ["list open issues in a repository", "github_list_issues"],
    ["read the comments on an issue", "github_issue_read"],
    ["merge a pull request", "github_merge_pull_request"],
    ["post a message to a slack channel", "slack_slack_post_message"],
    ["take a screenshot of the page", "playwright_browser_take_screenshot"],
    ["create a linear ticket", "linear_linear_create_issue"],
    ["read a text file from disk", "filesystem_read_text_file"],
    ["search code for a function name", "github_search_code"],
    ["click a button on the web page", "playwright_browser_click"],
    ["current authenticated user profile", "github_get_me"],
  ]

  test("finds the intended tool in the top 3 for at least 9 of 10 realistic queries", () => {
    const rows = QUERIES.map(([query, expected]) => {
      const top = ToolSearch.search(entries, query, 3).map((entry) => entry.name)
      return { query, expected, rank: top.indexOf(expected) + 1, top }
    })
    console.log("tool_search ranking", JSON.stringify(rows))
    expect(rows.filter((row) => row.rank > 0).length).toBeGreaterThanOrEqual(9)
    expect(rows.filter((row) => row.rank === 1).length).toBeGreaterThanOrEqual(8)
  })

  test("search results stay compact", () => {
    const result = ToolSearch.run(entries, new Set(), { query: "pull request", limit: 5 })
    expect(result.metadata.loaded.length).toBe(5)
    expect(Buffer.byteLength(result.output)).toBeLessThan(2000)
  })

  test("index lists names grouped by server and caps long servers", () => {
    const index = ToolSearch.index(entries)
    expect(index.split("\n").map((line) => line.slice(0, line.indexOf(":")))).toEqual([
      "filesystem (14)",
      "github (46)",
      "linear (5)",
      "playwright (26)",
      "slack (8)",
    ])
    expect(index).toContain(", … +6 more")
    expect(ToolSearch.estimateTokens(entries.filter((entry) => entry.namespace === "linear"))).toBeLessThan(
      ToolSearch.DEFAULT_THRESHOLD,
    )
    expect(ToolSearch.estimateTokens(entries.filter((entry) => entry.namespace === "github"))).toBeGreaterThan(
      ToolSearch.DEFAULT_THRESHOLD,
    )
  })
})
