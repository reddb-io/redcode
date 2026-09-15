import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM, Message, ToolCallPart, ToolResultPart } from "../../src"
import { Auth, LLMClient } from "../../src/route"
import * as AnthropicMessages from "../../src/protocols/anthropic-messages"
import { it } from "../lib/effect"
import { dynamicResponse, fixedResponse } from "../lib/http"
import { sseEvents } from "../lib/sse"

// Anthropic's server-side tool search (tool_search_tool_bm25_20251119): deferred definitions are
// sent flagged, the API searches them and answers with tool_reference blocks that must replay.

const model = AnthropicMessages.route
  .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
  .model({ id: "claude-sonnet-4-5" })

type Body = AnthropicMessages.AnthropicMessagesBody

const tools = [
  { name: "read", description: "Read a file", inputSchema: { type: "object", properties: {} } },
  {
    name: "github_issue_read",
    description: "Read a GitHub issue",
    inputSchema: { type: "object", properties: { issue_number: { type: "number" } } },
    deferLoading: true,
  },
]

const searchRequest = (input: { readonly messages?: Message[]; readonly toolSearch?: boolean } = {}) =>
  LLM.request({
    model,
    messages: input.messages ?? [Message.user("Read issue 7.")],
    tools,
    ...(input.toolSearch === false ? {} : { providerOptions: { anthropic: { toolSearch: "bm25" } } }),
  })

// A search that loads github_issue_read, then a call to it, as the API streams them.
const searchTurn = sseEvents(
  { type: "message_start", message: { usage: { input_tokens: 40 } } },
  {
    type: "content_block_start",
    index: 0,
    content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "tool_search_tool_bm25" },
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
  {
    type: "content_block_start",
    index: 2,
    content_block: { type: "tool_use", id: "toolu_2", name: "github_issue_read" },
  },
  { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"issue_number":7}' } },
  { type: "content_block_stop", index: 2 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 12 } },
)

const textTurn = sseEvents(
  { type: "message_start", message: { usage: { input_tokens: 60 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Issue 7 is open." } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
)

describe("Anthropic Messages tool search", () => {
  it.effect("sends deferred tools with defer_loading next to the search tool, breakpoint on a loaded tool", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare<Body>(searchRequest())

      expect(prepared.body.tools).toEqual([
        { type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" },
        {
          name: "read",
          description: "Read a file",
          input_schema: { type: "object", properties: {} },
          cache_control: { type: "ephemeral" },
        },
        {
          name: "github_issue_read",
          description: "Read a GitHub issue",
          input_schema: { type: "object", properties: { issue_number: { type: "number" } } },
          defer_loading: true,
        },
      ])
    }),
  )

  it.effect("never puts cache_control on a deferred tool, even when the caller marked it", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare<Body>(
        LLM.request({
          model,
          prompt: "Hi",
          cache: "none",
          tools: [{ ...tools[1]!, cache: new CacheHint({ type: "ephemeral" }) }],
          providerOptions: { anthropic: { toolSearch: "regex" } },
        }),
      )
      expect(prepared.body.tools).toEqual([
        { type: "tool_search_tool_regex_20251119", name: "tool_search_tool_regex" },
        expect.not.objectContaining({ cache_control: expect.anything() }),
      ])
      expect(prepared.body.tools?.[1]).toMatchObject({ name: "github_issue_read", defer_loading: true })
    }),
  )

  it.effect("sends deferred tools as ordinary tools when tool search is off", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare<Body>(searchRequest({ toolSearch: false }))
      expect(prepared.body.tools?.map((tool) => tool.name)).toEqual(["read", "github_issue_read"])
      expect(JSON.stringify(prepared.body.tools)).not.toContain("defer_loading")
    }),
  )

  it.effect("decodes a search and the call to the tool it loaded", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(searchRequest()).pipe(Effect.provide(fixedResponse(searchTurn)))

      const calls = response.events.filter((event) => event.type === "tool-call")
      expect(calls).toEqual([
        {
          type: "tool-call",
          id: "srvtoolu_1",
          name: "tool_search_tool_bm25",
          input: { query: "issue" },
          providerExecuted: true,
        },
        { type: "tool-call", id: "toolu_2", name: "github_issue_read", input: { issue_number: 7 } },
      ])
      expect(response.events.find((event) => event.type === "tool-result")).toMatchObject({
        type: "tool-result",
        id: "srvtoolu_1",
        name: "tool_search_tool_bm25",
        result: {
          type: "json",
          value: {
            type: "tool_search_tool_search_result",
            tool_references: [{ type: "tool_reference", tool_name: "github_issue_read" }],
          },
        },
        providerExecuted: true,
      })
    }),
  )

  it.effect("round-trips the tool_reference result into the next request with the same tools", () =>
    Effect.gen(function* () {
      const bodies: Body[] = []
      const layer = dynamicResponse((input) =>
        Effect.sync(() => {
          bodies.push(JSON.parse(input.text) as Body)
          return input.respond(bodies.length === 1 ? searchTurn : textTurn, {
            headers: { "content-type": "text/event-stream" },
          })
        }),
      )

      const first = yield* LLMClient.generate(searchRequest()).pipe(Effect.provide(layer))
      const call = first.events.find((event) => event.type === "tool-call" && !event.providerExecuted)
      const search = first.events.find((event) => event.type === "tool-call" && event.providerExecuted)
      const found = first.events.find((event) => event.type === "tool-result")
      if (call?.type !== "tool-call" || search?.type !== "tool-call" || found?.type !== "tool-result")
        throw new Error("expected a search, its result and a tool call")

      yield* LLMClient.generate(
        searchRequest({
          messages: [
            Message.user("Read issue 7."),
            Message.assistant([
              ToolCallPart.make({ id: search.id, name: search.name, input: search.input, providerExecuted: true }),
              ToolResultPart.make({
                id: found.id,
                name: found.name,
                result: found.result.value,
                providerExecuted: true,
              }),
              ToolCallPart.make({ id: call.id, name: call.name, input: call.input }),
            ]),
            Message.tool({ id: call.id, name: call.name, result: "Issue 7: open", resultType: "text" }),
          ],
        }),
      ).pipe(Effect.provide(layer))

      expect(bodies).toHaveLength(2)
      expect(bodies[1]!.messages[1]).toEqual({
        role: "assistant",
        content: [
          { type: "server_tool_use", id: "srvtoolu_1", name: "tool_search_tool_bm25", input: { query: "issue" } },
          {
            type: "tool_search_tool_result",
            tool_use_id: "srvtoolu_1",
            content: {
              type: "tool_search_tool_search_result",
              tool_references: [{ type: "tool_reference", tool_name: "github_issue_read" }],
            },
          },
          { type: "tool_use", id: "toolu_2", name: "github_issue_read", input: { issue_number: 7 } },
        ],
      })
      expect(bodies[1]!.messages[2]).toMatchObject({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "Issue 7: open" }],
      })
      // Loading a tool does not touch the tools block, which heads the cached prefix.
      expect(JSON.stringify(bodies[1]!.tools)).toBe(JSON.stringify(bodies[0]!.tools))
    }),
  )

  it.effect("replays a search result stored in the AI SDK shape as tool_reference blocks", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare<Body>(
        searchRequest({
          messages: [
            Message.user("Read issue 7."),
            Message.assistant([
              ToolCallPart.make({
                id: "srvtoolu_9",
                name: "tool_search_tool_bm25",
                input: { query: "issue" },
                providerExecuted: true,
              }),
              ToolResultPart.make({
                id: "srvtoolu_9",
                name: "tool_search_tool_bm25",
                result: [{ type: "tool_reference", toolName: "github_issue_read" }],
                providerExecuted: true,
              }),
            ]),
          ],
        }),
      )
      expect(prepared.body.messages[1]?.content[1]).toEqual({
        type: "tool_search_tool_result",
        tool_use_id: "srvtoolu_9",
        content: {
          type: "tool_search_tool_search_result",
          tool_references: [{ type: "tool_reference", tool_name: "github_issue_read" }],
        },
      })
    }),
  )
})
