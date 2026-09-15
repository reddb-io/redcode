// Provider-native tool search through LLM.stream (AI SDK runtime) against a fake HTTP server:
// request shapes, a streamed search round-tripped through session history, the 400 fallback, and
// the cached prefix before and after a step that loads a tool.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { jsonSchema, tool, type ModelMessage, type Tool } from "ai"
import { Effect, Exit, Stream } from "effect"
import { ConfigV1 } from "@reddb-io/redcode-core/v1/config/config"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { ModelsDev } from "@reddb-io/redcode-core/models-dev"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import type { LLMEvent } from "@reddb-io/redcode-llm"
import { Provider } from "@/provider/provider"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, SessionID } from "../../src/session/schema"
import { NativeToolSearch } from "@/session/native-tool-search"
import { ToolSearch } from "@/session/tool-search"
import type { Agent } from "../../src/agent/agent"
import { testEffect } from "../lib/effect"

type ConfigModel = NonNullable<NonNullable<ConfigV1.Info["provider"]>[string]["models"]>[string]
type Body = Record<string, any>

const it = testEffect(AppNodeBuilder.build(LayerNode.group([LLM.node, Provider.node])))

const MODELS = JSON.parse(
  fs.readFileSync(path.join(import.meta.dir, "../tool/fixtures/models-api.json"), "utf8"),
) as Record<string, ModelsDev.Provider>

// ---------------------------------------------------------------- fake provider server
const server = {
  handle: null as ReturnType<typeof Bun.serve> | null,
  queue: [] as Array<(body: Body) => Response>,
  bodies: [] as Array<{ path: string; body: Body }>,
}

beforeAll(() => {
  server.handle = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as Body
      server.bodies.push({ path: new URL(req.url).pathname, body })
      const next = server.queue.shift()
      return next ? next(body) : new Response("unexpected request", { status: 500 })
    },
  })
})
beforeEach(() => {
  server.queue.length = 0
  server.bodies.length = 0
})
afterEach(() => NativeToolSearch.reset())
afterAll(() => void server.handle?.stop())

const sse = (chunks: unknown[]) =>
  new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join("\n\n") + "\n\n", {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })

const messageStart = {
  type: "message_start",
  message: { id: "msg_1", model: "claude-sonnet-4-5", usage: { input_tokens: 10 } },
}
const messageEnd = (reason: string) => [
  { type: "message_delta", delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: 5 } },
  { type: "message_stop" },
]
const textTurn = () =>
  sse([
    messageStart,
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done." } },
    { type: "content_block_stop", index: 0 },
    ...messageEnd("end_turn"),
  ])
const searchTurn = () =>
  sse([
    messageStart,
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "tool_search_tool_bm25", input: {} },
    },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"issue"}' } },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "tool_search_tool_result",
        tool_use_id: "srvtoolu_1",
        content: {
          type: "tool_search_tool_search_result",
          tool_references: [{ type: "tool_reference", tool_name: "github_issue_read" }],
        },
      },
    },
    { type: "content_block_stop", index: 1 },
    ...messageEnd("end_turn"),
  ])

// ---------------------------------------------------------------- provider config
const providerConfig = (providerID: string, npm: string, modelID: string): Partial<ConfigV1.Info> => {
  const { experimental: _experimental, ...model } = MODELS[providerID]!.models[modelID]!
  return {
    enabled_providers: [providerID],
    provider: {
      [providerID]: {
        name: providerID,
        env: [],
        npm,
        models: { [modelID]: JSON.parse(JSON.stringify(model)) as ConfigModel },
        options: { apiKey: "test-key", baseURL: `${server.handle!.url.origin}/v1` },
      },
    },
  }
}
const anthropicConfig = () => providerConfig("anthropic", "@ai-sdk/anthropic", "claude-sonnet-4-5")
const openaiConfig = () => providerConfig("openai", "@ai-sdk/openai", "gpt-5.4")

const agent = {
  name: "build",
  mode: "primary",
  options: {},
  permission: [{ permission: "*", pattern: "*", action: "allow" }],
} satisfies Agent.Info

const sessionID = SessionID.make("session-native-tool-search")
const userFor = (resolved: Provider.Model) =>
  ({
    id: MessageID.make("msg_user"),
    sessionID,
    role: "user",
    time: { created: 1 },
    agent: agent.name,
    model: { providerID: resolved.providerID, modelID: resolved.id },
  }) satisfies SessionV1.User

// ---------------------------------------------------------------- tools, as SessionTools marks them
const MCP = Object.fromEntries(
  ["github", "linear", "slack", "filesystem", "playwright"].map((server) => [
    server,
    JSON.parse(
      fs.readFileSync(path.join(import.meta.dir, "fixtures", "mcp-schemas", `${server}.json`), "utf8"),
    ) as Array<{
      name: string
      description?: string
      inputSchema: Record<string, unknown>
    }>,
  ]),
)
const SRC = path.join(import.meta.dir, "../../src")
const NATIVE = fs
  .readdirSync(path.join(SRC, "tool"))
  .filter((file) => file.endsWith(".txt"))
  .toSorted()
  .map((file) => [file.slice(0, -4).replace(/-/g, "_"), fs.readFileSync(path.join(SRC, "tool", file), "utf8")] as const)
const SYSTEM = fs.readFileSync(path.join(SRC, "session", "prompt", "anthropic.txt"), "utf8")

const stub = (description: string, schema: Record<string, unknown> = { type: "object", properties: {} }): Tool =>
  tool({
    description,
    inputSchema: jsonSchema(schema as never),
    execute: async () => ({ output: "ok", title: "", metadata: {} }),
  })

/**
 * The tools map SessionTools hands the LLM for a Session whose MCP tools are all deferred:
 * native tools, `tool_search` (stamped with `mode`), deferred MCP tools, and loaded ones last.
 */
function sessionTools(input: { mode?: NativeToolSearch.Mode; loaded?: string[]; servers?: string[] } = {}) {
  const tools: Record<string, Tool> = {}
  for (const [name, description] of NATIVE) tools[name] = stub(description)
  tools[ToolSearch.TOOL_ID] = ToolSearch.withNative(stub(ToolSearch.DESCRIPTION, ToolSearch.InputSchema), input.mode)
  const loaded = input.loaded ?? []
  for (const server of input.servers ?? ["github"])
    for (const item of MCP[server]!) {
      const name = `${server}_${item.name}`
      if (loaded.includes(name)) continue
      tools[name] = ToolSearch.markDeferred(stub(item.description ?? "", item.inputSchema), server)
    }
  loaded.forEach((name, rank) => {
    const item = MCP.github!.find((entry) => `github_${entry.name}` === name)!
    tools[name] = ToolSearch.markActivated(stub(item.description ?? "", item.inputSchema), rank)
  })
  return tools
}

const stream = (input: LLM.StreamInput) =>
  LLM.Service.use((svc) => svc.stream(input).pipe(Stream.runCollect)).pipe(Effect.map((chunk) => [...chunk]))

const getModel = (providerID: string, modelID: string) =>
  Provider.use.getModel(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID))

const toolNames = (body: Body) =>
  (body.tools as Array<{ name?: string; type?: string }>).map((item) => item.name ?? item.type)

describe("session.llm native tool search", () => {
  it.instance(
    "anthropic: sends deferred tools flagged next to the BM25 search tool, without tool_search",
    () =>
      Effect.gen(function* () {
        const resolved = yield* getModel("anthropic", "claude-sonnet-4-5")
        server.queue.push(textTurn)
        yield* stream({
          user: userFor(resolved),
          sessionID,
          model: resolved,
          agent,
          system: ["You are helpful."],
          messages: [{ role: "user", content: "Read issue 7." }],
          tools: sessionTools({ mode: "anthropic" }),
        })

        const { body } = server.bodies[0]!
        const tools = body.tools as Array<Record<string, unknown>>
        expect(tools).toContainEqual({ type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" })
        expect(toolNames(body)).not.toContain("tool_search")
        const issue = tools.find((item) => item.name === "github_issue_read")!
        expect(issue.defer_loading).toBe(true)
        expect(issue.cache_control).toBeUndefined()
        for (const item of tools) if (item.defer_loading) expect(item.cache_control).toBeUndefined()
        expect(tools.filter((item) => item.name && !item.defer_loading).map((item) => item.name)).toContain("read")
      }),
    { config: anthropicConfig },
  )

  it.instance(
    "anthropic: a streamed search persists and replays with the tool it loaded, keeping the tools block",
    () =>
      Effect.gen(function* () {
        const resolved = yield* getModel("anthropic", "claude-sonnet-4-5")
        const tools = sessionTools({ mode: "anthropic" })
        server.queue.push(searchTurn)
        const events: LLMEvent[] = yield* stream({
          user: userFor(resolved),
          sessionID,
          model: resolved,
          agent,
          system: ["You are helpful."],
          messages: [{ role: "user", content: "Read issue 7." }],
          tools,
        })
        const call = events.find((event) => event.type === "tool-call")
        const result = events.find((event) => event.type === "tool-result")
        expect(call).toMatchObject({ name: "tool_search_tool_bm25", input: { query: "issue" }, providerExecuted: true })
        expect(result).toMatchObject({
          name: "tool_search_tool_bm25",
          result: { type: "json", value: [{ type: "tool_reference", toolName: "github_issue_read" }] },
        })

        // As the processor stores it: a provider-executed tool part whose output is the JSON result.
        const stored = JSON.stringify(result!.type === "tool-result" ? result!.result.value : undefined)
        const history = [
          {
            info: { ...userFor(resolved) },
            parts: [{ id: "p_user", sessionID, messageID: "msg_user", type: "text", text: "Read issue 7." }],
          },
          {
            info: {
              id: "msg_assistant",
              sessionID,
              role: "assistant",
              time: { created: 2, completed: 3 },
              parentID: "msg_user",
              modelID: resolved.id,
              providerID: resolved.providerID,
              mode: "build",
              agent: "build",
              path: { cwd: "/", root: "/" },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              finish: "tool-calls",
            },
            parts: [
              {
                id: "p_search",
                sessionID,
                messageID: "msg_assistant",
                type: "tool",
                tool: "tool_search_tool_bm25",
                callID: "srvtoolu_1",
                metadata: { providerExecuted: true },
                state: {
                  status: "completed",
                  input: { query: "issue" },
                  output: stored,
                  metadata: {},
                  title: "tool_search_tool_bm25",
                  time: { start: 2, end: 2 },
                },
              },
              {
                id: "p_issue",
                sessionID,
                messageID: "msg_assistant",
                type: "tool",
                tool: "github_issue_read",
                callID: "toolu_2",
                state: {
                  status: "completed",
                  input: { issue_number: 7 },
                  output: "Issue 7: open",
                  metadata: {},
                  title: "",
                  time: { start: 3, end: 3 },
                },
              },
            ],
          },
        ] as unknown as SessionV1.WithParts[]
        expect([...NativeToolSearch.referenced(history)]).toEqual(["github_issue_read"])

        const messages = yield* Effect.promise(() => MessageV2.toModelMessages(history as never, resolved))
        server.queue.push(textTurn)
        yield* stream({
          user: userFor(resolved),
          sessionID,
          model: resolved,
          agent,
          system: ["You are helpful."],
          messages,
          tools,
        })

        const [first, second] = server.bodies.map((item) => item.body)
        const assistant = (second!.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>).find(
          (message) => message.role === "assistant",
        )!
        expect(assistant.content).toContainEqual(
          expect.objectContaining({ type: "server_tool_use", id: "srvtoolu_1", name: "tool_search_tool_bm25" }),
        )
        expect(assistant.content).toContainEqual(
          expect.objectContaining({
            type: "tool_search_tool_result",
            tool_use_id: "srvtoolu_1",
            content: {
              type: "tool_search_tool_search_result",
              tool_references: [{ type: "tool_reference", tool_name: "github_issue_read" }],
            },
          }),
        )
        expect(assistant.content).toContainEqual(
          expect.objectContaining({ type: "tool_use", id: "toolu_2", name: "github_issue_read" }),
        )
        expect(JSON.stringify(second!.tools)).toBe(JSON.stringify(first!.tools))
      }),
    { config: anthropicConfig },
  )

  it.instance(
    "openai: sends deferred functions in a namespace per server next to hosted tool_search",
    () =>
      Effect.gen(function* () {
        const resolved = yield* getModel("openai", "gpt-5.4")
        server.queue.push(() => new Response("{}", { status: 500 }))
        yield* stream({
          user: userFor(resolved),
          sessionID,
          model: resolved,
          agent,
          system: ["You are helpful."],
          messages: [{ role: "user", content: "Read issue 7." }],
          tools: sessionTools({ mode: "openai", servers: ["github", "linear"] }),
        }).pipe(Effect.exit)

        const { path: pathname, body } = server.bodies[0]!
        expect(pathname.endsWith("/responses")).toBe(true)
        const tools = body.tools as Array<Record<string, any>>
        expect(tools).toContainEqual({ type: "tool_search" })
        expect(tools.some((item) => item.name === "tool_search")).toBe(false)
        const github = tools.find((item) => item.type === "namespace" && item.name === "github")!
        expect(github.description).toBe("Tools from github.")
        expect(github.tools).toContainEqual(
          expect.objectContaining({ type: "function", name: "github_issue_read", defer_loading: true }),
        )
        expect(tools.find((item) => item.type === "namespace" && item.name === "linear")).toBeDefined()
        expect(tools).toContainEqual(expect.objectContaining({ type: "function", name: "read" }))
      }),
    { config: openaiConfig },
  )

  it.instance(
    "falls back to tool_search once when the provider rejects native search, and remembers it",
    () =>
      Effect.gen(function* () {
        const resolved = yield* getModel("anthropic", "claude-sonnet-4-5")
        server.queue.push(
          () =>
            new Response(
              JSON.stringify({
                type: "error",
                error: {
                  type: "invalid_request_error",
                  message:
                    "tools.16: Input tag 'tool_search_tool_bm25_20251119' found using 'type' does not match any of the expected tags",
                },
              }),
              { status: 400, headers: { "content-type": "application/json" } },
            ),
          textTurn,
        )
        const exit = yield* stream({
          user: userFor(resolved),
          sessionID,
          model: resolved,
          agent,
          system: ["You are helpful."],
          messages: [{ role: "user", content: "Read issue 7." }],
          tools: sessionTools({ mode: "anthropic" }),
        }).pipe(Effect.exit)

        expect(Exit.isSuccess(exit)).toBe(true)
        const [rejected, retried] = server.bodies.map((item) => item.body)
        expect(toolNames(rejected!)).toContain("tool_search_tool_bm25")
        expect(toolNames(retried!)).toContain("tool_search")
        expect(toolNames(retried!)).not.toContain("tool_search_tool_bm25")
        expect(toolNames(retried!)).not.toContain("github_issue_read")
        expect(JSON.stringify(retried!.tools)).not.toContain("defer_loading")
        expect(NativeToolSearch.isRejected(resolved)).toBe(true)
      }),
    { config: anthropicConfig },
  )

  it.instance(
    "does not retry an unrelated 400",
    () =>
      Effect.gen(function* () {
        const resolved = yield* getModel("anthropic", "claude-sonnet-4-5")
        server.queue.push(
          () =>
            new Response(
              JSON.stringify({
                type: "error",
                error: { type: "invalid_request_error", message: "prompt is too long" },
              }),
              {
                status: 400,
                headers: { "content-type": "application/json" },
              },
            ),
        )
        const exit = yield* stream({
          user: userFor(resolved),
          sessionID,
          model: resolved,
          agent,
          system: ["You are helpful."],
          messages: [{ role: "user", content: "Read issue 7." }],
          tools: sessionTools({ mode: "anthropic" }),
        }).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        expect(server.bodies).toHaveLength(1)
        expect(NativeToolSearch.isRejected(resolved)).toBe(false)
      }),
    { config: anthropicConfig },
  )

  it.instance(
    "without a native mode the client-side tool_search is advertised and deferred tools are not",
    () =>
      Effect.gen(function* () {
        const resolved = yield* getModel("anthropic", "claude-sonnet-4-5")
        server.queue.push(textTurn)
        yield* stream({
          user: userFor(resolved),
          sessionID,
          model: resolved,
          agent,
          system: ["You are helpful."],
          messages: [{ role: "user", content: "Read issue 7." }],
          tools: sessionTools(),
        })
        const { body } = server.bodies[0]!
        expect(toolNames(body)).toContain("tool_search")
        expect(toolNames(body)).not.toContain("github_issue_read")
        expect(JSON.stringify(body.tools)).not.toContain("tool_search_tool_bm25")
      }),
    { config: anthropicConfig },
  )

  // ---------------------------------------------------------------- cache prefix
  // What Anthropic's prefix cache sees, in order: tools loaded up front, system, messages.
  // Deferred definitions are outside the rendered prefix (the API expands a loaded one where its
  // tool_reference sits), and cache_control markers are not content.
  const canonical = (body: Body) => {
    const strip = (value: unknown) => JSON.stringify(value, (key, item) => (key === "cache_control" ? undefined : item))
    const tools = (body.tools as Array<Record<string, unknown>>).filter((item) => !item.defer_loading)
    return strip(tools) + strip(body.system ?? []) + (body.messages as unknown[]).map(strip).join("")
  }
  const preserved = (before: Body, after: Body) => {
    const a = canonical(before)
    const b = canonical(after)
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    return { commonPrefixChars: i, previousChars: a.length, pct: +((100 * i) / a.length).toFixed(1) }
  }

  it.instance(
    "loading a tool keeps the cached prefix with native search and rewrites it with tool_search",
    () =>
      Effect.gen(function* () {
        const resolved = yield* getModel("anthropic", "claude-sonnet-4-5")
        const servers = ["github", "linear", "slack", "filesystem", "playwright"]
        const base = {
          user: userFor(resolved),
          sessionID,
          model: resolved,
          agent,
          system: [SYSTEM],
        }
        const user: ModelMessage = { role: "user", content: "Read GitHub issue 7 and summarise it." }
        const issueCall: ModelMessage[] = [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "toolu_2",
                toolName: "github_issue_read",
                output: { type: "text", value: "Issue 7: open" },
              },
            ],
          },
        ]

        // Client-side: step 1 advertises tool_search; step 2 follows its result, with the loaded tool appended.
        server.queue.push(textTurn, textTurn)
        yield* stream({ ...base, messages: [user], tools: sessionTools({ servers }) })
        yield* stream({
          ...base,
          messages: [
            user,
            {
              role: "assistant",
              content: [
                { type: "tool-call", toolCallId: "toolu_1", toolName: "tool_search", input: { query: "read issue" } },
              ],
            },
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: "toolu_1",
                  toolName: "tool_search",
                  output: { type: "text", value: "Loaded 1 tool, callable from your next step:\ngithub_issue_read" },
                },
              ],
            },
          ],
          tools: sessionTools({ servers, loaded: ["github_issue_read"] }),
        })
        const [clientBefore, clientAfter] = server.bodies.map((item) => item.body)
        server.bodies.length = 0

        // Native: the search, its result and the call land in one assistant turn; the tools do not change.
        server.queue.push(textTurn, textTurn)
        yield* stream({ ...base, messages: [user], tools: sessionTools({ servers, mode: "anthropic" }) })
        yield* stream({
          ...base,
          messages: [
            user,
            {
              role: "assistant",
              content: [
                {
                  type: "tool-call",
                  toolCallId: "srvtoolu_1",
                  toolName: "tool_search_tool_bm25",
                  input: { query: "read issue" },
                  providerExecuted: true,
                },
                {
                  type: "tool-result",
                  toolCallId: "srvtoolu_1",
                  toolName: "tool_search_tool_bm25",
                  output: { type: "json", value: [{ type: "tool_reference", toolName: "github_issue_read" }] },
                },
                { type: "tool-call", toolCallId: "toolu_2", toolName: "github_issue_read", input: { issue_number: 7 } },
              ],
            } as ModelMessage,
            ...issueCall,
          ],
          tools: sessionTools({ servers, mode: "anthropic" }),
        })
        const [nativeBefore, nativeAfter] = server.bodies.map((item) => item.body)

        const client = preserved(clientBefore!, clientAfter!)
        const native = preserved(nativeBefore!, nativeAfter!)
        console.log(
          JSON.stringify({ cachePrefixWhenLoadingATool: { clientToolSearch: client, nativeToolSearch: native } }),
        )
        expect(JSON.stringify(nativeAfter!.tools)).toBe(JSON.stringify(nativeBefore!.tools))
        expect(native.pct).toBeGreaterThanOrEqual(99)
        expect(client.pct).toBeLessThan(native.pct)
      }),
    { config: anthropicConfig },
  )
})
