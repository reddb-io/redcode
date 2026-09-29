// A scripted OpenAI-compatible endpoint for smoke-testing a built Redcode binary without model credentials.
//
// Each scenario is chosen by a `smoke:<name>` marker in the newest user message that carries one. The endpoint
// answers one scripted tool call per step, counting the tool results that follow that message, and then a final
// text. Requests without tools (titles, summaries) get a short plain answer so they never consume a step.
// Usage counts reasoning apart from completion, which Redcode must still store as non-zero output.

export * as FakeProvider from "./fake-provider"

export type ToolCall = {
  readonly name: string
  /** The arguments, or a function of the earlier tool results in this turn, for calls that chain IDs. */
  readonly input: Record<string, unknown> | ((results: ReadonlyArray<string>) => Record<string, unknown>)
}

export type Scenario = {
  readonly calls: ReadonlyArray<ToolCall>
  readonly text: string
}

export type Request = {
  readonly scenario?: string
  readonly tools: ReadonlyArray<string>
  readonly body: Record<string, unknown>
}

// Counts reasoning apart from completion, as some OpenAI-compatible proxies do: total = prompt + completion +
// reasoning. Redcode must still store a non-zero output count for such a step.
export const usage = {
  prompt_tokens: 40,
  completion_tokens: 12,
  total_tokens: 40 + 12 + 30,
  completion_tokens_details: { reasoning_tokens: 30 },
}

export function start(scenarios: Readonly<Record<string, Scenario>>) {
  const requests: Array<Request> = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname.endsWith("/models"))
        return Response.json({
          object: "list",
          data: [{ id: MODEL, object: "model", owned_by: "smoke", context_length: 128_000, max_output_tokens: 8_192 }],
        })
      if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions"))
        return new Response("not found", { status: 404 })
      const body = record(await request.json())
      const messages = Array.isArray(body.messages) ? body.messages.map(record) : []
      const tools = Array.isArray(body.tools)
        ? body.tools.map((tool) => record(record(tool).function).name).filter((name) => typeof name === "string")
        : []
      // Agents may inject their own user-role context after a tool call, so anchor on the marked prompt.
      const latest = messages.findLastIndex((message) => message.role === "user" && MARKER.test(text(message.content)))
      const name = latest === -1 ? undefined : MARKER.exec(text(messages[latest].content))?.[1]
      requests.push({ scenario: name, tools, body })
      const scenario = name === undefined || tools.length === 0 ? undefined : scenarios[name]
      const results = messages
        .slice(latest + 1)
        .filter((message) => message.role === "tool")
        .map((message) => text(message.content))
      const call = scenario?.calls[results.length]
      const answer = call
        ? {
            call: {
              name: call.name,
              input: typeof call.input === "function" ? call.input(results) : call.input,
              id: `call_smoke_${name}_${results.length}`,
            },
          }
        : { text: scenario?.text ?? "Smoke title" }
      if (body.stream !== true) return Response.json(completion(answer))
      return new Response(stream(answer), {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      })
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}/v1`,
    requests,
    stop: () => server.stop(true),
  }
}

export const MODEL = "smoke-model"

const MARKER = /smoke:([a-z0-9-]+)/

type Answer =
  | { readonly call: { readonly id: string; readonly name: string; readonly input: Record<string, unknown> } }
  | { readonly text: string }

function stream(answer: Answer) {
  const base = { id: "chatcmpl-smoke", object: "chat.completion.chunk", created: now(), model: MODEL }
  const chunks = [
    { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
    "call" in answer
      ? {
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: answer.call.id,
                    type: "function",
                    function: { name: answer.call.name, arguments: JSON.stringify(answer.call.input) },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }
      : { ...base, choices: [{ index: 0, delta: { content: answer.text }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "call" in answer ? "tool_calls" : "stop" }] },
    { ...base, choices: [], usage },
  ]
  return [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), "data: [DONE]\n\n"].join("")
}

function completion(answer: Answer) {
  return {
    id: "chatcmpl-smoke",
    object: "chat.completion",
    created: now(),
    model: MODEL,
    choices: [
      {
        index: 0,
        message:
          "call" in answer
            ? {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: answer.call.id,
                    type: "function",
                    function: { name: answer.call.name, arguments: JSON.stringify(answer.call.input) },
                  },
                ],
              }
            : { role: "assistant", content: answer.text },
        finish_reason: "call" in answer ? "tool_calls" : "stop",
      },
    ],
    usage,
  }
}

function now() {
  return Math.floor(Date.now() / 1000)
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

// OpenAI content is either a string or an array of typed parts.
function text(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part) => record(part).text)
    .filter((part) => typeof part === "string")
    .join("\n")
}
