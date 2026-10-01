export * as IntegrationCheck from "./integration-check.js"

import { ConnectionCheck } from "@opencode/schema/connection-check"
import { Effect, Schema } from "effect"
import { Credential } from "./credential.js"
import { Generate } from "./generate.js"
import { Integration } from "./integration.js"
import { Model } from "./model.js"
import { Provider } from "./provider.js"
import { RemoteCheck } from "./remote-check.js"
import { normalizeRouterEndpoint, redRouterEndpoint } from "./intelligence/red-router-endpoint.js"

export const check = Effect.fn("IntegrationCheck.check")(function* (integrationID: Integration.ID) {
  const requests: ConnectionCheck.Request[] = []
  const result = yield* Effect.gen(function* () {
    const integrations = yield* Integration.Service
    const integration = yield* integrations.get(integrationID)
    const active = yield* integrations.connection.active(integrationID)
    if (!integration || !active) return yield* Effect.fail(new Error("No saved or environment connection is available"))
    if (integration.metadata?.source === "mcp")
      return yield* Effect.fail(
        new Error(
          "MCP authentication is saved. Use the MCP panel to check the server connection; no model API request was sent.",
        ),
      )
    if (["red-router", "9router"].includes(integrationID)) {
      const credentials = yield* Credential.Service
      const credential = active.type === "credential" ? yield* credentials.get(active.id) : undefined
      const value = yield* integrations.connection.resolve(active)
      const key = value?.type === "key" ? value.key : value?.access
      const baseURL =
        integrationID === "red-router"
          ? redRouterEndpoint(credential)
          : normalizeRouterEndpoint(
              value?.type === "key" && typeof value.configuration?.baseURL === "string"
                ? value.configuration.baseURL
                : typeof value?.metadata?.baseURL === "string"
                  ? value.metadata.baseURL
                  : (process.env.NINE_ROUTER_BASE_URL ?? "http://127.0.0.1:20128/v1"),
            )
      if (!key || !baseURL)
        return yield* Effect.fail(new Error("The connection has no valid API key or HTTP(S) base URL"))
      const catalog = yield* Effect.tryPromise({
        try: async (signal) => {
          const response = await RemoteCheck.request(
            `${baseURL}/models${integrationID === "red-router" ? "?capabilities=chat" : ""}`,
            {
              redirect: "error",
              signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
              headers: { accept: "application/json", authorization: `Bearer ${key}` },
            },
            requests,
          )
          if (!response.ok) throw new Error(`Model catalog returned HTTP ${response.status}`)
          return response.json() as Promise<unknown>
        },
        catch: (error) => (error instanceof Error ? error : new Error("The model catalog could not be reached")),
      }).pipe(
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) }))(
            body,
          ).pipe(
            Effect.mapError(
              () => new Error("HTTP response is not an OpenAI model catalog: expected data with model IDs"),
            ),
          ),
        ),
      )
      requests[requests.length - 1].models = catalog.data.length
      if (!catalog.data.length)
        return yield* Effect.fail(
          new Error(
            "HTTP 200 returned an empty model catalog. Check the key's allowed models and the Router's upstream connections.",
          ),
        )
      return `Catalog checked: ${catalog.data.length} models visible to this connection. Generation was not checked; use /setup to test a selected S2 model.`
    }
    const providers = yield* Provider.Service
    const ids = new Set(
      (yield* providers.available())
        .filter((provider) => (provider.integrationID ?? provider.id) === integrationID)
        .map((provider) => provider.id),
    )
    const models = yield* Model.Service
    const model = (yield* models.available()).find(
      (model) => ids.has(model.providerID) && model.capabilities.output.includes("text"),
    )
    if (!model)
      return yield* Effect.fail(
        new Error("No generation model is available for this connection. No remote API request was sent."),
      )
    const generate = yield* Generate.Service
    yield* generate
      .text({
        prompt: "Reply with OK.",
        model: Model.Ref.make({ providerID: model.providerID, id: model.id }),
        http: RemoteCheck.http(requests),
      })
      .pipe(Effect.timeout("15 seconds"))
    if (!requests.length)
      return yield* Effect.fail(
        new Error("Generation completed without an observed remote HTTP request. API availability was not verified."),
      )
    return `Generation checked: ${model.providerID}/${model.id}`
  }).pipe(
    Effect.match({
      onSuccess: (message) => ({ ok: true, message, requests }),
      onFailure: (error) => ({
        ok: false,
        message: error instanceof Error ? error.message : "Remote API check failed",
        requests,
      }),
    }),
  )
  return result
})
