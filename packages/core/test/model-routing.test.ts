import { afterAll, describe, expect } from "bun:test"
import { AIError, HttpOptions, LLM, isRetryable } from "@opencode/ai"
import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { compileRequest } from "@opencode/ai/route/client"
import { OpenAICompatible, OpenAICompatibleResponses, OpenAI, OpenRouter } from "@opencode/ai/providers"
import { ModelRouting } from "@opencode/core/model-routing"
import { Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClientRequest } from "effect/unstable/http"
import { it } from "./lib/effect"

const payload = Schema.StructWithRest(Schema.Struct({ model: Schema.String }), [
  Schema.Record(Schema.String, Schema.Unknown),
])
const received: Array<{ path: string; body: typeof payload.Type; authorization: string | null }> = []
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    const body = Schema.decodeUnknownSync(payload)(await request.json())
    received.push({ path, body, authorization: request.headers.get("authorization") })
    if (path.includes("/auth/")) return Response.json({ error: { message: "Rejected key" } }, { status: 401 })
    if (path.includes("/limited/")) return Response.json({ error: { message: "Rate limit" } }, { status: 429 })
    const headers = {
      "content-type": "text/event-stream",
      "x-litellm-attempted-fallbacks": path.includes("/fallback/") ? "1" : "0",
      "x-litellm-model-group": path.includes("/substitution/") ? "claude-sonnet-5" : body.model,
      // Deployment names can differ for a deliberately selected alias. The model group remains the selected alias.
      "x-litellm-model-name": "openrouter/z-ai/glm-5.3-flash",
    }
    return new Response(
      `data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "selected model" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      { headers },
    )
  },
})
afterAll(() => server.stop(true))

const layer = LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer.pipe(Layer.provide(FetchHttpClient.layer))))

describe("Selected model routing", () => {
  for (const provider of [OpenAICompatible, OpenAICompatibleResponses]) {
    it.effect(`pins ${provider.routes[0].id} without reconnecting or opting in`, () =>
      Effect.gen(function* () {
        const model = ModelRouting.apply(
          provider
            .configure({
              apiKey: "selected-key",
              baseURL: `${server.url.origin}/auth/v1`,
              http: {
                body: {
                  model: "claude-sonnet-5",
                  disable_fallbacks: false,
                  fallbacks: ["sonnet"],
                  models: ["sonnet"],
                  custom: true,
                },
              },
            })
            .model("glm-5.3-flash"),
        )
        const error = yield* LLM.generate({ model, prompt: "Test" }, { http: ModelRouting.middleware(model) }).pipe(
          Effect.flip,
        )
        expect(error.reason._tag).toBe("Authentication")
        expect(received.at(-1)?.authorization).toBe("Bearer selected-key")
        expect(received.at(-1)?.body).toMatchObject({
          model: "glm-5.3-flash",
          disable_fallbacks: true,
          fallbacks: [],
          context_window_fallbacks: [],
          content_policy_fallbacks: [],
          models: ["glm-5.3-flash"],
          custom: true,
        })
      }).pipe(Effect.provide(layer)),
    )
  }

  it.effect("preserves an explicitly selected alias and rejects hook-injected fallback options", () =>
    Effect.gen(function* () {
      const model = ModelRouting.apply(
        OpenAICompatible.configure({ apiKey: "selected-key", baseURL: `${server.url.origin}/ok/v1` }).model(
          "my-glm-alias",
        ),
      )
      const result = yield* LLM.generate(
        {
          model,
          prompt: "Test",
          http: new HttpOptions({ body: { model: "sonnet", fallbacks: ["sonnet"], disable_fallbacks: false } }),
        },
        {
          http: ModelRouting.middleware(model, (request, handler) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(request)
              const body = Schema.decodeUnknownSync(payload)(yield* Effect.promise(() => web.json()))
              return yield* handler(
                yield* HttpClientRequest.bodyJson(request, { ...body, model: "sonnet", disable_fallbacks: false }),
              )
            }),
          ),
        },
      )
      expect(result.text).toBe("selected model")
      expect(received.at(-1)?.body.model).toBe("my-glm-alias")
      expect(received.at(-1)?.body.disable_fallbacks).toBe(true)
    }).pipe(Effect.provide(layer)),
  )

  for (const path of ["fallback", "substitution"]) {
    it.effect(`rejects a gateway ${path} before text or tools, without retrying`, () =>
      Effect.gen(function* () {
        const model = ModelRouting.apply(
          OpenAICompatible.configure({ apiKey: "selected-key", baseURL: `${server.url.origin}/${path}/v1` }).model(
            "glm-5.3-flash",
          ),
        )
        const before = received.length
        const error = yield* LLM.generate({ model, prompt: "Test" }, { http: ModelRouting.middleware(model) }).pipe(
          Effect.flip,
        )
        expect(error).toBeInstanceOf(AIError)
        expect(error.reason._tag).toBe("InvalidProviderOutput")
        expect(error.message).toContain("did not honor the selected model")
        expect(error.reason.http?.status).toBe(200)
        expect(isRetryable(error)).toBe(false)
        expect(received.length).toBe(before + 1)
      }).pipe(Effect.provide(layer)),
    )
  }

  it.effect("retains a rate limit on the selected model instead of choosing another", () =>
    Effect.gen(function* () {
      const model = ModelRouting.apply(
        OpenAICompatible.configure({ apiKey: "selected-key", baseURL: `${server.url.origin}/limited/v1` }).model(
          "glm-5.3-flash",
        ),
      )
      const error = yield* LLM.generate({ model, prompt: "Test" }, { http: ModelRouting.middleware(model) }).pipe(
        Effect.flip,
      )
      expect(error.reason._tag).toBe("RateLimit")
      expect(received.at(-1)?.body.model).toBe("glm-5.3-flash")
    }).pipe(Effect.provide(layer)),
  )

  it.effect("restricts OpenRouter model and upstream fallback lists while retaining selected upstreams", () =>
    Effect.gen(function* () {
      const model = ModelRouting.apply(
        OpenRouter.configure({
          apiKey: "fixture",
          baseURL: `${server.url.origin}/ok/v1`,
          http: { body: { provider: { sort: "latency" }, custom: true } },
          providerOptions: {
            models: ["sonnet"],
            provider: { only: ["z-ai"], allow_fallbacks: true },
            reasoning: { max_tokens: 100_000 },
          },
        }).model("z-ai/glm-5.3-flash"),
      )
      const result = yield* LLM.generate(
        { model, prompt: "Test", generation: { maxTokens: 4_096 } },
        { http: ModelRouting.middleware(model) },
      )
      expect(result.text).toBe("selected model")
      expect(received.at(-1)?.body).toMatchObject({
        model: "z-ai/glm-5.3-flash",
        models: ["z-ai/glm-5.3-flash"],
        provider: { only: ["z-ai"], sort: "latency", allow_fallbacks: false },
        custom: true,
      })
      const reasoning = Schema.decodeUnknownSync(Schema.Struct({ max_tokens: Schema.Number }))(
        received.at(-1)?.body.reasoning,
      )
      expect(reasoning.max_tokens).toBeGreaterThan(0)
      expect(reasoning.max_tokens).toBeLessThan(4_096)
    }).pipe(Effect.provide(layer)),
  )

  it.effect("does not add gateway-only fields to the native OpenAI API", () =>
    Effect.gen(function* () {
      const model = OpenAI.configure({ apiKey: "fixture" }).chat("gpt-5.5")
      expect(ModelRouting.apply(model)).toBe(model)
      const request = yield* compileRequest(LLM.request({ model, prompt: "Test" }))
      expect(request.body).not.toHaveProperty("disable_fallbacks")
    }),
  )
})
