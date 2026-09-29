import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM, supportsForcedToolChoice } from "../src/index.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import { Auth } from "../src/route.js"
import { Tool, toDefinitions } from "../src/tool.js"
import { it } from "./lib/effect.js"
import { dynamicResponse } from "./lib/http.js"
import { deltaChunk, finishChunk, toolCallChunk } from "./lib/openai-chunks.js"
import { sseEvents } from "./lib/sse.js"

type OpenAIChatBody = {
  readonly tool_choice?: unknown
  readonly messages?: ReadonlyArray<{ readonly role: string; readonly content?: unknown }>
  readonly tools?: ReadonlyArray<{
    readonly function: {
      readonly parameters: unknown
    }
  }>
}

const model = OpenAIChat.route
  .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "gpt-4o-mini" })

const Json = Schema.fromJsonString(Schema.Unknown)
const decodeJson = Schema.decodeUnknownSync(Json)
const decodeBody = (text: string): OpenAIChatBody => decodeJson(text) as OpenAIChatBody

describe("Tool.make (dynamic JSON Schema)", () => {
  test("forwards JSON Schema and description through toDefinitions", () => {
    const jsonSchema = {
      type: "object" as const,
      properties: { city: { type: "string" } },
      required: ["city"],
    }
    const lookup = Tool.make({
      description: "Look up something",
      jsonSchema,
      execute: () => Effect.succeed({ ok: true }),
    })
    const [definition] = toDefinitions({ lookup })
    expect(definition?.name).toBe("lookup")
    expect(definition?.description).toBe("Look up something")
    expect(definition?.inputSchema).toEqual(jsonSchema)
  })

  it.effect("execute receives the raw input untouched", () =>
    Effect.gen(function* () {
      const seen: unknown[] = []
      const tool = Tool.make({
        description: "echo",
        jsonSchema: { type: "object" },
        execute: (params) =>
          Effect.sync(() => {
            seen.push(params)
            return { ok: true }
          }),
      })
      const result = yield* tool.execute({ hello: "world" })
      expect(seen).toEqual([{ hello: "world" }])
      expect(result).toEqual({ ok: true })
    }),
  )
})

describe("LLM.generateObject", () => {
  it.effect("forces a synthetic tool call and decodes the input", () =>
    Effect.gen(function* () {
      const bodies: OpenAIChatBody[] = []
      const layer = dynamicResponse((input) =>
        Effect.sync(() => {
          bodies.push(decodeBody(input.text))
          return input.respond(
            sseEvents(
              toolCallChunk("call_1", "generate_object", '{"city":"Paris","temp":22}'),
              finishChunk("tool_calls"),
            ),
            { headers: { "content-type": "text/event-stream" } },
          )
        }),
      )

      const response = yield* LLM.generateObject({
        model,
        prompt: "Return a structured weather report.",
        schema: Schema.Struct({ city: Schema.String, temp: Schema.Number }),
      }).pipe(Effect.provide(layer))

      expect(response.object).toEqual({ city: "Paris", temp: 22 })
      expect(response.response.toolCalls).toHaveLength(1)
      expect(bodies).toHaveLength(1)
      expect(bodies[0].tool_choice).toEqual({ type: "function", function: { name: "generate_object" } })
      const tool = bodies[0].tools?.[0]
      expect(bodies[0].tools).toHaveLength(1)
      expect(tool).toMatchObject({
        type: "function",
        function: { name: "generate_object" },
      })
      const params = tool?.function.parameters as {
        readonly type?: unknown
        readonly required?: unknown
        readonly properties?: Record<string, unknown>
      }
      expect(params.type).toBe("object")
      expect(params.required).toEqual(["city", "temp"])
      expect(params.properties?.city).toMatchObject({ type: "string" })
      expect(params.properties?.temp).toBeDefined()
    }),
  )

  it.effect("accepts a raw JSON Schema and returns the input untouched", () =>
    Effect.gen(function* () {
      const bodies: OpenAIChatBody[] = []
      const layer = dynamicResponse((input) =>
        Effect.sync(() => {
          bodies.push(decodeBody(input.text))
          return input.respond(
            sseEvents(toolCallChunk("call_1", "generate_object", '{"name":"Ada","age":30}'), finishChunk("tool_calls")),
            { headers: { "content-type": "text/event-stream" } },
          )
        }),
      )

      const response = yield* LLM.generateObject({
        model,
        prompt: "Extract the user.",
        jsonSchema: {
          type: "object",
          properties: { name: { type: "string" }, age: { type: "number" } },
          required: ["name", "age"],
        },
      }).pipe(Effect.provide(layer))

      expect(response.object).toEqual({ name: "Ada", age: 30 })
      expect(bodies[0].tools?.[0]?.function.parameters).toEqual({
        type: "object",
        properties: { name: { type: "string" }, age: { type: "number" } },
        required: ["name", "age"],
      })
    }),
  )

  it.effect("fails when the model does not call the synthetic tool", () =>
    Effect.gen(function* () {
      const layer = dynamicResponse((input) =>
        Effect.sync(() =>
          input.respond(sseEvents({ id: "x", choices: [{ delta: { content: "no thanks" }, finish_reason: "stop" }] }), {
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      )

      const exit = yield* LLM.generateObject({
        model,
        prompt: "Return a structured value.",
        schema: Schema.Struct({ value: Schema.Number }),
      }).pipe(Effect.provide(layer), Effect.exit)

      expect(exit._tag).toBe("Failure")
    }),
  )

  it.effect("fails with a decode error when the tool input does not match the schema", () =>
    Effect.gen(function* () {
      const layer = dynamicResponse((input) =>
        Effect.sync(() =>
          input.respond(
            sseEvents(
              toolCallChunk("call_1", "generate_object", '{"value":"not-a-number"}'),
              finishChunk("tool_calls"),
            ),
            { headers: { "content-type": "text/event-stream" } },
          ),
        ),
      )

      const exit = yield* LLM.generateObject({
        model,
        prompt: "Return a structured value.",
        schema: Schema.Struct({ value: Schema.Number }),
      }).pipe(Effect.provide(layer), Effect.exit)

      expect(exit._tag).toBe("Failure")
    }),
  )
})

describe("supportsForcedToolChoice", () => {
  test.each([
    "claude-opus-5-5",
    "claude-opus-5.5",
    "anthropic/claude-opus-5.5",
    "cc/claude-opus-5-5",
    "us.anthropic.claude-opus-5-5-v1:0",
    "claude-opus-5-5@20260922",
    "claude-opus-6",
    "claude-fable-5-1",
    "claude-mythos-preview",
  ])("refuses for %s", (id) => {
    expect(supportsForcedToolChoice(id)).toBe(false)
  })

  test.each(["claude-opus-5", "claude-opus-4-7", "claude-sonnet-5-5", "claude-3-5-sonnet-20240620", "gpt-4o-mini"])(
    "accepts for %s",
    (id) => {
      expect(supportsForcedToolChoice(id)).toBe(true)
    },
  )

  test("a declared capability wins over the model id", () => {
    expect(supportsForcedToolChoice("gpt-4o-mini", false)).toBe(false)
    expect(supportsForcedToolChoice("claude-opus-5-5", true)).toBe(true)
  })
})

describe("LLM.generateObject without a forced tool choice", () => {
  const refusing = OpenAIChat.route
    .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
    .model({ id: "claude-opus-5-5" })

  const textReply = (text: string) => sseEvents(deltaChunk({ role: "assistant", content: text }), finishChunk("stop"))

  const replies = (texts: ReadonlyArray<string>, bodies: OpenAIChatBody[]) =>
    dynamicResponse((input) =>
      Effect.sync(() => {
        bodies.push(decodeBody(input.text))
        return input.respond(textReply(texts[bodies.length - 1] ?? ""), {
          headers: { "content-type": "text/event-stream" },
        })
      }),
    )

  it.effect("prompts for the JSON object and validates it", () =>
    Effect.gen(function* () {
      const bodies: OpenAIChatBody[] = []
      const response = yield* LLM.generateObject({
        model: refusing,
        prompt: "Return a structured weather report.",
        schema: Schema.Struct({ city: Schema.String, temp: Schema.Number }),
      }).pipe(Effect.provide(replies(['```json\n{"city":"Paris","temp":22}\n```'], bodies)))

      expect(response.object).toEqual({ city: "Paris", temp: 22 })
      expect(bodies).toHaveLength(1)
      expect(bodies[0].tool_choice).toBeUndefined()
      expect(bodies[0].tools ?? []).toHaveLength(0)
      const system = JSON.stringify(bodies[0].messages?.filter((message) => message.role === "system"))
      expect(system).toContain("JSON Schema")
      expect(system).toContain("temp")
    }),
  )

  it.effect("repairs an invalid reply once", () =>
    Effect.gen(function* () {
      const bodies: OpenAIChatBody[] = []
      const response = yield* LLM.generateObject({
        model: refusing,
        prompt: "Return a structured value.",
        schema: Schema.Struct({ value: Schema.Number }),
      }).pipe(Effect.provide(replies(['{"value":"not-a-number"}', '{"value":3}'], bodies)))

      expect(response.object).toEqual({ value: 3 })
      expect(bodies).toHaveLength(2)
      const repair = bodies[1].messages ?? []
      expect(repair.at(-2)?.role).toBe("assistant")
      expect(repair.at(-1)?.role).toBe("user")
      expect(JSON.stringify(repair.at(-1)?.content)).toContain("not a valid JSON object")
    }),
  )

  it.effect("fails when the repaired reply is still invalid", () =>
    Effect.gen(function* () {
      const bodies: OpenAIChatBody[] = []
      const exit = yield* LLM.generateObject({
        model: refusing,
        prompt: "Return a structured value.",
        schema: Schema.Struct({ value: Schema.Number }),
      }).pipe(Effect.provide(replies(["no thanks", "still no"], bodies)), Effect.exit)

      expect(exit._tag).toBe("Failure")
      expect(bodies).toHaveLength(2)
    }),
  )

  it.effect("follows a declared refusal on any model", () =>
    Effect.gen(function* () {
      const bodies: OpenAIChatBody[] = []
      const response = yield* LLM.generateObject({
        model: OpenAIChat.route
          .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
          .model({ id: "router-combo", compatibility: { forcedToolChoice: false } }),
        prompt: "Extract the user.",
        jsonSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      }).pipe(Effect.provide(replies(['{"name":"Ada"}'], bodies)))

      expect(response.object).toEqual({ name: "Ada" })
      expect(bodies[0].tool_choice).toBeUndefined()
    }),
  )

  it.effect("relaxes a forced tool choice to auto on a refusing model", () =>
    Effect.gen(function* () {
      const bodies: OpenAIChatBody[] = []
      yield* LLM.generate({
        model: refusing,
        prompt: "Look it up.",
        tools: toDefinitions({
          lookup: Tool.make({ description: "Look up", jsonSchema: { type: "object" }, execute: () => Effect.void }),
        }),
        toolChoice: "required",
      }).pipe(Effect.provide(replies(["ok"], bodies)))

      expect(bodies[0].tool_choice).toBe("auto")
      expect(bodies[0].tools).toHaveLength(1)
    }),
  )
})
