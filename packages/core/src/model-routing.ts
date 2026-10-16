export * as ModelRouting from "./model-routing.js"

import { AIError, HttpOptions, InvalidProviderOutputError, LanguageModel, mergeHttpOptions } from "@opencode/ai"
import { isRecord } from "@opencode/ai/utils/record"
import { RequestExecutor, type HttpMiddleware } from "@opencode/ai/route"
import { Effect, Schema } from "effect"
import { HttpClientRequest } from "effect/unstable/http"

const gateway = (model: LanguageModel) =>
  ["openai-compatible-chat", "openai-compatible-responses"].includes(model.route.id)

/** Apply to saved connections too; routing is a product invariant, not a connection wizard preference. */
export function body(model: LanguageModel, source: Record<string, unknown> = {}) {
  if (gateway(model))
    return {
      ...source,
      model: model.id,
      disable_fallbacks: true,
      fallbacks: [],
      context_window_fallbacks: [],
      content_policy_fallbacks: [],
      // OpenRouter accepts a models list as well as model. Never let an old list select a different model.
      ...(source.models === undefined ? {} : { models: [model.id] }),
    }
  if (model.route.id === "openrouter")
    return {
      ...source,
      model: model.id,
      models: [model.id],
      provider: { ...(isRecord(source.provider) ? source.provider : {}), allow_fallbacks: false },
    }
  return source
}

export function apply(model: LanguageModel) {
  if (!gateway(model) && model.route.id !== "openrouter") return model
  const http = mergeHttpOptions(model.route.defaults.http, model.defaults?.http)
  return LanguageModel.update(model, {
    defaults: {
      ...model.defaults,
      http: new HttpOptions({
        ...http,
        body: body(model, {
          ...(model.route.id === "openrouter"
            ? { ...model.route.defaults.providerOptions, ...model.defaults?.providerOptions }
            : {}),
          ...http?.body,
        }),
      }),
    },
  })
}

/** Guard after request hooks, before sending or consuming any substituted content or tool calls. */
export function middleware(model: LanguageModel, inner?: HttpMiddleware): HttpMiddleware {
  return (request, handler) => {
    const guarded: typeof handler = (sent) =>
      Effect.gen(function* () {
        const outgoing =
          gateway(model) || model.route.id === "openrouter"
            ? yield* Effect.gen(function* () {
                const web = yield* HttpClientRequest.toWeb(sent)
                const source = yield* Effect.tryPromise(() => web.json()).pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown))),
                )
                return yield* HttpClientRequest.bodyJson(sent, body(model, source))
              })
            : sent
        const response = yield* handler(outgoing)
        // Same-group deployment retries are allowed. A cross-model fallback is not.
        const count = Number(response.headers["x-litellm-attempted-fallbacks"])
        const group = response.headers["x-litellm-model-group"]
        if (response.status < 400 && (count > 0 || (group && group !== model.id)))
          return yield* new AIError({
            reason: new InvalidProviderOutputError({
              message: `The gateway did not honor the selected model ${model.provider}/${model.id}. Redcode rejected its fallback response${group ? ` (${group})` : ""}. Disable fallbacks on the gateway or explicitly select another model.`,
              http: RequestExecutor.responseHttp(response),
            }),
          })
        return response
      }).pipe(Effect.mapError((error) => (error instanceof Error ? error : new Error(String(error)))))
    return inner ? inner(request, guarded) : guarded(request)
  }
}
