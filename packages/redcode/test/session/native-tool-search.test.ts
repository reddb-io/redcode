import { afterEach, describe, expect, test } from "bun:test"
import { APICallError, jsonSchema, tool, type ModelMessage } from "ai"
import {
  HttpContext,
  HttpRequestDetails,
  HttpResponseDetails,
  InvalidRequestReason,
  LLMError,
} from "@reddb-io/redcode-llm"
import type { LLMRequest } from "@reddb-io/redcode-llm"
import { LLMClient, RequestExecutor, type LLMClientShape } from "@reddb-io/redcode-llm/route"
import { Effect, Layer, Stream } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import type { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import type { Provider } from "@/provider/provider"
import { LLMNativeRuntime } from "@/session/llm/native-runtime"
import { LLMNative } from "@/session/llm/native-request"
import { NativeToolSearch } from "@/session/native-tool-search"
import { ToolSearch } from "@/session/tool-search"

const model = (providerID: string, id: string, npm: string) =>
  ({ id, providerID, api: { id, npm, url: "" } }) as unknown as Provider.Model

const anthropic = model("anthropic", "claude-sonnet-4-5", "@ai-sdk/anthropic")
const gpt54 = model("openai", "gpt-5.4", "@ai-sdk/openai")

afterEach(() => NativeToolSearch.reset())

describe("NativeToolSearch.detect", () => {
  test("auto uses the allowlist by provider package and model", () => {
    expect(NativeToolSearch.detect({ model: anthropic })).toBe("anthropic")
    expect(
      NativeToolSearch.detect({ model: model("anthropic", "claude-haiku-4-5-20251001", "@ai-sdk/anthropic") }),
    ).toBe("anthropic")
    expect(NativeToolSearch.detect({ model: model("anthropic", "claude-fable-5-1", "@ai-sdk/anthropic") })).toBe(
      "anthropic",
    )
    expect(
      NativeToolSearch.detect({ model: model("anthropic", "claude-opus-4-1", "@ai-sdk/anthropic") }),
    ).toBeUndefined()
    expect(NativeToolSearch.detect({ model: gpt54 })).toBe("openai")
    expect(NativeToolSearch.detect({ model: model("openai", "gpt-6", "@ai-sdk/openai") })).toBe("openai")
    expect(NativeToolSearch.detect({ model: model("openai", "gpt-5.2", "@ai-sdk/openai") })).toBeUndefined()
    // A proxy speaking the Anthropic protocol is not assumed to run the search tool.
    expect(NativeToolSearch.detect({ model: model("zen", "claude-sonnet-4-5", "@ai-sdk/anthropic") })).toBeUndefined()
    expect(
      NativeToolSearch.detect({ model: model("openrouter", "gpt-5.4", "@ai-sdk/openai-compatible") }),
    ).toBeUndefined()
  })

  test("the config override forces it on for a capable package, or off", () => {
    const proxy = model("zen", "claude-sonnet-4-5", "@ai-sdk/anthropic")
    expect(NativeToolSearch.detect({ model: proxy, config: { native: true } })).toBe("anthropic")
    expect(NativeToolSearch.detect({ model: anthropic, config: { native: false } })).toBeUndefined()
    expect(NativeToolSearch.detect({ model: anthropic, config: { enabled: false } })).toBeUndefined()
    // No mechanism to force for other packages: they keep the client-side tool_search.
    expect(
      NativeToolSearch.detect({
        model: model("openrouter", "anthropic/claude-sonnet-4.5", "@openrouter/ai-sdk-provider"),
        config: { native: true },
      }),
    ).toBeUndefined()
  })

  test("auto stays off for older models, other hosts and other variants", () => {
    const off = (providerID: string, id: string, npm: string) =>
      expect(NativeToolSearch.detect({ model: model(providerID, id, npm) })).toBeUndefined()
    off("anthropic", "claude-3-5-sonnet-20241022", "@ai-sdk/anthropic")
    off("anthropic", "claude-3-5-sonnet", "@ai-sdk/anthropic")
    off("anthropic", "claude-sonnet-4-20250514", "@ai-sdk/anthropic")
    off("anthropic", "claude-opus-4-1-20250805", "@ai-sdk/anthropic")
    off("amazon-bedrock", "us.anthropic.claude-sonnet-4-5-20250929-v1:0", "@ai-sdk/amazon-bedrock")
    off("google-vertex-anthropic", "claude-sonnet-4-5@20250929", "@ai-sdk/google-vertex/anthropic")
    off("openai", "gpt-5-codex", "@ai-sdk/openai")
    off("openai", "gpt-5.3-codex", "@ai-sdk/openai")
    off("openai", "o3", "@ai-sdk/openai")
    off("azure", "gpt-5.4", "@ai-sdk/azure")
  })

  test("an id outside the allowlist, such as a [1m] variant, stays off unless forced", () => {
    const variant = model("anthropic", "claude-sonnet-4-5[1m]", "@ai-sdk/anthropic")
    expect(NativeToolSearch.detect({ model: variant })).toBeUndefined()
    expect(NativeToolSearch.detect({ model: variant, config: { native: true } })).toBe("anthropic")
  })

  test("OpenAI needs the AI SDK runtime; Anthropic works on both", () => {
    expect(NativeToolSearch.detect({ model: gpt54, nativeLlm: true })).toBeUndefined()
    expect(NativeToolSearch.detect({ model: anthropic, nativeLlm: true })).toBe("anthropic")
  })

  test("a rejection turns it off for that model for the rest of the process", () => {
    NativeToolSearch.reject(anthropic)
    expect(NativeToolSearch.detect({ model: anthropic })).toBeUndefined()
    expect(NativeToolSearch.detect({ model: anthropic, config: { native: true } })).toBeUndefined()
    expect(NativeToolSearch.detect({ model: model("anthropic", "claude-opus-4-6", "@ai-sdk/anthropic") })).toBe(
      "anthropic",
    )
  })
})

describe("NativeToolSearch.aiSdk", () => {
  const stub = (description: string) =>
    tool({ description, inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => "" })
  const tools = () => ({
    read: stub("Read"),
    tool_search: ToolSearch.withNative(stub("Search"), "openai"),
    github_issue_read: ToolSearch.markDeferred(stub("Issue"), "github"),
    linear_get_issue: ToolSearch.markActivated(stub("Linear"), 0),
  })

  test("Anthropic: the search tool takes tool_search's place and deferred tools are advertised flagged", () => {
    const result = NativeToolSearch.aiSdk(tools(), "anthropic")
    expect(Object.keys(result.tools)).toEqual([
      "read",
      "tool_search_tool_bm25",
      "github_issue_read",
      "linear_get_issue",
    ])
    expect(result.tools.tool_search_tool_bm25).toMatchObject({
      type: "provider",
      id: "anthropic.tool_search_bm25_20251119",
    })
    expect(result.tools.github_issue_read!.providerOptions).toEqual({ anthropic: { deferLoading: true } })
    expect(result.tools.read!.providerOptions).toBeUndefined()
    expect(result.active.toSorted()).toEqual(["github_issue_read", "linear_get_issue", "read", "tool_search_tool_bm25"])
  })

  test("OpenAI: deferred functions go in one namespace per server", () => {
    const result = NativeToolSearch.aiSdk(tools(), "openai")
    expect(result.tools.tool_search).toMatchObject({ type: "provider", id: "openai.tool_search" })
    expect(result.tools.github_issue_read!.providerOptions).toEqual({
      openai: { deferLoading: true, namespace: { name: "github", description: "Tools from github." } },
    })
    // Still dispatchable through the ordinary execute path.
    expect(typeof result.tools.github_issue_read!.execute).toBe("function")
  })
})

describe("native LLM runtime", () => {
  test("sends deferred definitions flagged with Anthropic's BM25 search tool", async () => {
    const requests: LLMRequest[] = []
    const llmClient = {
      stream: (request: LLMRequest) => {
        requests.push(request)
        return Stream.empty
      },
    } as unknown as LLMClientShape
    const stub = () =>
      tool({
        description: "stub",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => "",
      })
    const tools = {
      read: stub(),
      tool_search: ToolSearch.withNative(stub(), "anthropic"),
      github_issue_read: ToolSearch.markDeferred(stub(), "github"),
    }
    const plan = NativeToolSearch.native(tools)
    expect(plan).toEqual({ deferred: ["github_issue_read"], advertise: ["read", "github_issue_read"] })

    const result = LLMNativeRuntime.stream({
      model: {
        ...anthropic,
        api: { id: "claude-sonnet-4-5", npm: "@ai-sdk/anthropic", url: "https://api.anthropic.com/v1" },
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: false,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        limit: { context: 200_000, output: 8_000 },
        headers: {},
        options: {},
      } as unknown as Provider.Model,
      provider: { id: "anthropic", options: { apiKey: "test" } } as unknown as Provider.Info,
      auth: undefined,
      llmClient,
      messages: [{ role: "user", content: "Read issue 7." }],
      tools,
      advertise: plan.advertise,
      toolSearch: { deferred: plan.deferred },
      headers: {},
      abort: new AbortController().signal,
    })
    if (result.type !== "supported") throw new Error(result.reason)
    await Effect.runPromise(Stream.runDrain(result.stream))

    const prepared = await Effect.runPromise(
      LLMClient.prepare<{ tools: Array<Record<string, unknown>> }>(requests[0]!).pipe(
        Effect.provide(
          LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer.pipe(Layer.provide(FetchHttpClient.layer)))),
        ),
      ),
    )
    expect(prepared.body.tools.map((item) => item.name)).toEqual(["tool_search_tool_bm25", "read", "github_issue_read"])
    expect(prepared.body.tools[0]).toEqual({ type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" })
    expect(prepared.body.tools[2]).toMatchObject({ defer_loading: true })
    expect(prepared.body.tools[2]!.cache_control).toBeUndefined()
  })

  test("the trailing-reminder breakpoint never lands on a provider-executed search", async () => {
    const request = LLMNative.request({
      model: {
        ...anthropic,
        api: { id: "claude-sonnet-4-5", npm: "@ai-sdk/anthropic", url: "https://api.anthropic.com/v1" },
        limit: { context: 200_000, output: 8_000 },
        headers: {},
      } as unknown as Provider.Model,
      apiKey: "test",
      messages: [
        { role: "user", content: "Read issue 7." },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Looking." },
            {
              type: "tool-call",
              toolCallId: "srvtoolu_1",
              toolName: "tool_search_tool_bm25",
              input: { query: "issue" },
              providerExecuted: true,
            },
            {
              type: "tool-result",
              toolCallId: "srvtoolu_1",
              toolName: "tool_search_tool_bm25",
              output: { type: "json", value: [{ type: "tool_reference", toolName: "github_issue_read" }] },
              providerExecuted: true,
            } as never,
          ],
        },
        { role: "user", content: [{ type: "text", text: "<system-reminder>\nNo tasks.\n</system-reminder>" }] },
      ],
    })
    const prepared = await Effect.runPromise(
      LLMClient.prepare<{ messages: Array<{ role: string; content: Array<Record<string, unknown>> }> }>(request).pipe(
        Effect.provide(
          LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer.pipe(Layer.provide(FetchHttpClient.layer)))),
        ),
      ),
    )
    const assistant = prepared.body.messages[1]!.content
    expect(assistant.map((block) => block.type)).toEqual(["text", "server_tool_use", "tool_search_tool_result"])
    expect(assistant[0]!.cache_control).toEqual({ type: "ephemeral" })
    expect(assistant[1]!.cache_control).toBeUndefined()
    expect(assistant[2]!.cache_control).toBeUndefined()
  })
})

describe("NativeToolSearch.history", () => {
  const search = (id: string, toolName: string): ModelMessage["content"] => [
    { type: "tool-call", toolCallId: id, toolName, input: { query: "issue" }, providerExecuted: true },
    {
      type: "tool-result",
      toolCallId: id,
      toolName,
      output: { type: "json", value: [{ type: "tool_reference", toolName: "github_issue_read" }] },
    },
  ]
  const history = (content: ModelMessage["content"]): ModelMessage[] => [
    { role: "user", content: "Read issue 7." },
    { role: "assistant", content } as ModelMessage,
  ]
  const available = new Set(["read", "github_issue_read"])

  test("keeps the current mode's searches", () => {
    const messages = history([...(search("s1", "tool_search_tool_bm25") as never[]), { type: "text", text: "ok" }])
    expect(NativeToolSearch.history(messages, "anthropic", available)).toBe(messages)
  })

  test("drops searches when native search is off or the mode differs, and empty assistant messages", () => {
    const messages = history(search("s1", "tool_search_tool_bm25"))
    expect(NativeToolSearch.history(messages, undefined, available)).toEqual([messages[0]!])
    expect(NativeToolSearch.history(messages, "openai", available)).toEqual([messages[0]!])
  })

  test("keeps a search that found nothing, as the provider saw it", () => {
    const messages = history([
      { type: "tool-call", toolCallId: "s1", toolName: "tool_search_tool_bm25", input: {}, providerExecuted: true },
      { type: "tool-result", toolCallId: "s1", toolName: "tool_search_tool_bm25", output: { type: "json", value: [] } },
      { type: "tool-call", toolCallId: "t1", toolName: "tool_search", input: {}, providerExecuted: true },
      {
        type: "tool-result",
        toolCallId: "t1",
        toolName: "tool_search",
        output: { type: "json", value: { tools: [] } },
      },
    ])
    expect(NativeToolSearch.history(messages, "anthropic", available)[1]).toEqual({
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "s1", toolName: "tool_search_tool_bm25", input: {}, providerExecuted: true },
        {
          type: "tool-result",
          toolCallId: "s1",
          toolName: "tool_search_tool_bm25",
          output: { type: "json", value: [] },
        },
      ],
    })
    expect((NativeToolSearch.history(messages, "openai", available)[1] as { content: unknown[] }).content).toHaveLength(
      2,
    )
  })

  test("narrows Anthropic references to tools still sent and drops a search left with none", () => {
    const messages = history([
      { type: "tool-call", toolCallId: "s1", toolName: "tool_search_tool_bm25", input: {}, providerExecuted: true },
      {
        type: "tool-result",
        toolCallId: "s1",
        toolName: "tool_search_tool_bm25",
        output: {
          type: "json",
          value: [
            { type: "tool_reference", toolName: "github_issue_read" },
            { type: "tool_reference", toolName: "github_gone" },
          ],
        },
      },
      { type: "tool-call", toolCallId: "s2", toolName: "tool_search_tool_bm25", input: {}, providerExecuted: true },
      {
        type: "tool-result",
        toolCallId: "s2",
        toolName: "tool_search_tool_bm25",
        output: { type: "json", value: [{ type: "tool_reference", toolName: "github_gone" }] },
      },
    ])
    expect(NativeToolSearch.history(messages, "anthropic", available)[1]).toEqual({
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "s1", toolName: "tool_search_tool_bm25", input: {}, providerExecuted: true },
        {
          type: "tool-result",
          toolCallId: "s1",
          toolName: "tool_search_tool_bm25",
          output: { type: "json", value: [{ type: "tool_reference", toolName: "github_issue_read" }] },
        },
      ],
    })
  })

  test("narrows OpenAI loaded functions and namespaces to tools still sent", () => {
    const fn = (name: string) => ({ type: "function", name })
    const messages = history([
      { type: "tool-call", toolCallId: "t1", toolName: "tool_search", input: {}, providerExecuted: true },
      {
        type: "tool-result",
        toolCallId: "t1",
        toolName: "tool_search",
        output: {
          type: "json",
          value: {
            tools: [
              { type: "namespace", name: "github", tools: [fn("github_issue_read"), fn("github_denied")] },
              { type: "namespace", name: "gone", tools: [fn("gone_tool")] },
              fn("read"),
            ],
          },
        },
      },
    ])
    const result = NativeToolSearch.history(messages, "openai", available)[1] as {
      content: Array<{ output?: unknown }>
    }
    expect(result.content[1]!.output).toEqual({
      type: "json",
      value: { tools: [{ type: "namespace", name: "github", tools: [fn("github_issue_read")] }, fn("read")] },
    })
  })

  test("drops a failed or unanswered search", () => {
    const failed = history([
      { type: "tool-call", toolCallId: "s1", toolName: "tool_search_tool_bm25", input: {}, providerExecuted: true },
      {
        type: "tool-result",
        toolCallId: "s1",
        toolName: "tool_search_tool_bm25",
        output: { type: "error-text", value: "x" },
      },
      { type: "text", text: "kept" },
    ])
    expect(NativeToolSearch.history(failed, "anthropic", available)[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "kept" }],
    })
    const unanswered = history([
      { type: "tool-call", toolCallId: "s2", toolName: "tool_search_tool_bm25", input: {}, providerExecuted: true },
      { type: "text", text: "kept" },
    ])
    expect(NativeToolSearch.history(unanswered, "anthropic", available)[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "kept" }],
    })
  })

  test("leaves the client-side tool_search alone", () => {
    const messages = history([
      { type: "tool-call", toolCallId: "c1", toolName: "tool_search", input: { query: "issue" } },
    ] as never)
    expect(NativeToolSearch.history(messages, undefined, available)).toBe(messages)
  })

  test("clientHint rewrites the native index lead for a fallback request", () => {
    const entries = [{ name: "github_issue_read", namespace: "github", description: "", schema: {} }]
    const native = ToolSearch.indexText(entries, true)
    const [system, wrapped] = NativeToolSearch.clientHint([
      { role: "system", content: native },
      { role: "user", content: [{ type: "text", text: `<system-reminder>${native}</system-reminder>` }] },
    ])
    expect(system!.content).toContain("Additional tools for github are available through tool_search. Example:")
    expect(system!.content).toContain('{"select": ["github_<name>"]}')
    expect(system!.content).toContain("<deferred_tools>")
    expect(JSON.stringify(wrapped)).not.toContain("Find them with your tool search tool")
    expect(ToolSearch.clientIndexLead(ToolSearch.indexText(entries))).toBe(ToolSearch.indexText(entries))
  })
})

describe("NativeToolSearch persistence", () => {
  const part = (tool: string, output: string, providerExecuted = true) =>
    ({
      type: "tool",
      tool,
      callID: "c",
      state: { status: "completed", input: {}, output, metadata: {}, title: "", time: { start: 1, end: 2 } },
      metadata: providerExecuted ? { providerExecuted: true } : undefined,
    }) as unknown as SessionV1.Part

  const messages = (...parts: SessionV1.Part[]) =>
    [{ info: { time: { created: 1 } }, parts }] as unknown as SessionV1.WithParts[]

  test("referenced reads the tools a native search loaded, in every stored shape", () => {
    const names = NativeToolSearch.referenced(
      messages(
        part("tool_search_tool_bm25", JSON.stringify([{ type: "tool_reference", toolName: "github_issue_read" }])),
        part(
          "tool_search_tool_bm25",
          JSON.stringify({ type: "tool_search_tool_search_result", tool_references: [{ tool_name: "slack_post" }] }),
        ),
        part("tool_search", JSON.stringify({ tools: [{ type: "function", name: "linear_get_issue" }] })),
        // Client-side tool_search is not a native search.
        part("tool_search", JSON.stringify({ name: "filesystem_read" }), false),
      ),
    )
    expect([...names].toSorted()).toEqual(["github_issue_read", "linear_get_issue", "slack_post"])
  })

  test("referenced ignores OpenAI namespace names and unparsable output", () => {
    const names = NativeToolSearch.referenced(
      messages(
        part(
          "tool_search",
          JSON.stringify({
            tools: [{ type: "namespace", name: "github", tools: [{ type: "function", name: "github_issue_read" }] }],
          }),
        ),
        part("tool_search_tool_bm25", "not json"),
      ),
    )
    expect([...names]).toEqual(["github_issue_read"])
  })

  test("a natively loaded tool stays deferred after it is called", () => {
    const history = messages(
      part("tool_search_tool_bm25", JSON.stringify([{ type: "tool_reference", toolName: "github_issue_read" }])),
      part("github_issue_read", "Issue 7", false),
    )
    const names = new Set(["github_issue_read"])
    expect(ToolSearch.loadedFromHistory(history, names)).toEqual(["github_issue_read"])
    expect(ToolSearch.loadedFromHistory(history, names, NativeToolSearch.referenced(history))).toEqual([])
  })

  test("replayOutput converts a wire result to the AI SDK shape and keeps others", () => {
    expect(
      NativeToolSearch.replayOutput(
        JSON.stringify({
          type: "tool_search_tool_search_result",
          tool_references: [{ type: "tool_reference", tool_name: "github_issue_read" }],
        }),
      ),
    ).toEqual([{ type: "tool_reference", toolName: "github_issue_read" }])
    expect(NativeToolSearch.replayOutput('{"tools":[]}')).toEqual({ tools: [] })
    expect(NativeToolSearch.replayOutput("not json")).toBe("not json")
  })
})

describe("NativeToolSearch.isRejection", () => {
  const apiError = (statusCode: number, responseBody: string) =>
    new APICallError({ message: "Bad Request", url: "https://api", requestBodyValues: {}, statusCode, responseBody })

  test("a 400 about the search tool, deferral or a beta", () => {
    expect(
      NativeToolSearch.isRejection(
        apiError(400, '{"error":{"message":"tools.0: Input tag \'tool_search_tool_bm25_20251119\' found"}}'),
      ),
    ).toBe(true)
    expect(
      NativeToolSearch.isRejection(apiError(400, '{"error":{"message":"Unknown parameter: defer_loading"}}')),
    ).toBe(true)
    expect(NativeToolSearch.isRejection(apiError(400, '{"error":{"message":"prompt is too long"}}'))).toBe(false)
    expect(
      NativeToolSearch.isRejection(
        apiError(400, '{"error":{"message":"Tool reference \'github_issue_read\' not found in available tools"}}'),
      ),
    ).toBe(true)
    expect(
      NativeToolSearch.isRejection(
        apiError(400, '{"error":{"message":"Invalid value: \'namespace\'.","param":"tools[3].type"}}'),
      ),
    ).toBe(true)
    // Unrelated 400s that share generic words with the old pattern.
    expect(
      NativeToolSearch.isRejection(
        apiError(400, '{"error":{"message":"The long context beta is not yet available for this subscription."}}'),
      ),
    ).toBe(false)
    expect(
      NativeToolSearch.isRejection(apiError(400, '{"error":{"message":"anthropic-beta: unknown beta context-1m"}}')),
    ).toBe(false)
    expect(NativeToolSearch.isRejection(apiError(400, '{"error":{"message":"Invalid tool type in tools.0"}}'))).toBe(
      false,
    )
    expect(NativeToolSearch.isRejection(apiError(500, "tool_search overloaded"))).toBe(false)
    expect(NativeToolSearch.isRejection(new Error("tool_search"))).toBe(false)
  })

  test("errors about the client-side tool_search function are not rejections", () => {
    expect(
      NativeToolSearch.isRejection(
        apiError(400, '{"error":{"message":"Invalid \'tools[4].name\': duplicate function name \'tool_search\'."}}'),
      ),
    ).toBe(false)
    expect(
      NativeToolSearch.isRejection(
        apiError(400, '{"error":{"message":"tools.3.custom.input_schema: invalid schema for tool \\"tool_search\\""}}'),
      ),
    ).toBe(false)
    expect(
      NativeToolSearch.isRejection(
        apiError(400, '{"error":{"message":"Invalid value: \'tool_search\'. Supported values are: \'function\'."}}'),
      ),
    ).toBe(true)
  })

  test("a missing tool reference is a history problem, not missing support", () => {
    const missing = apiError(400, '{"error":{"message":"Tool reference \'github_gone\' not found in available tools"}}')
    expect(NativeToolSearch.isRejection(missing)).toBe(true)
    expect(NativeToolSearch.isMissingReference(missing)).toBe(true)
    expect(
      NativeToolSearch.isMissingReference(
        apiError(400, '{"error":{"message":"Input tag \'tool_search_tool_bm25_20251119\' found"}}'),
      ),
    ).toBe(false)
  })

  test("the native runtime's invalid request error", () => {
    const error = new LLMError({
      module: "RequestExecutor",
      method: "execute",
      reason: new InvalidRequestReason({
        message: "Bad Request",
        http: new HttpContext({
          request: new HttpRequestDetails({ method: "POST", url: "https://api", headers: {} }),
          response: new HttpResponseDetails({ status: 400, headers: {} }),
          body: '{"error":{"message":"tools.0.type: unknown tool type tool_search_tool_bm25_20251119"}}',
        }),
      }),
    })
    expect(NativeToolSearch.isRejection(error)).toBe(true)
  })
})
