import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schedule, Schema, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { IntelligenceEvaluation } from "../../intelligence/evaluation.js"
import { redRouterEndpoint } from "../../intelligence/red-router-endpoint.js"
import { Integration } from "../../integration.js"
import { KV } from "../../kv.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { Hash } from "@opencode/util/hash"

const catalogModel = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  api_format: Schema.optional(Schema.String),
  supported_endpoints: Schema.optional(Schema.Array(Schema.String)),
  input_modalities: Schema.optional(Schema.Array(Schema.String)),
  output_modalities: Schema.optional(Schema.Array(Schema.String)),
  context_length: Schema.optional(Schema.Number),
  max_output_tokens: Schema.optional(Schema.Number),
  capabilities: Schema.optional(
    Schema.Struct({
      tool_calling: Schema.optional(Schema.Boolean),
      reasoning: Schema.optional(Schema.Boolean),
      supportsThinking: Schema.optional(Schema.Boolean),
      temperature: Schema.optional(Schema.Boolean),
    }),
  ),
})
const catalog = Schema.Struct({
  data: Schema.Array(Schema.Unknown),
})

type CatalogModel = typeof catalogModel.Type
type Connection = { readonly baseURL: string; readonly key: string; readonly integrationID: Integration.ID }

export const RedRouterPlugin = routerPlugin({
  id: "red-router",
  name: "RedRouter",
  defaultBaseURL: "http://127.0.0.1:25050/v1",
  keyEnv: "RED_ROUTER_API_KEY",
  urlEnv: "RED_ROUTER_BASE_URL",
})
export const NineRouterPlugin = routerPlugin({
  id: "9router",
  name: "9Router",
  defaultBaseURL: "http://127.0.0.1:20128/v1",
  keyEnv: "NINE_ROUTER_API_KEY",
  urlEnv: "NINE_ROUTER_BASE_URL",
})

function routerPlugin(options: {
  id: "red-router" | "9router"
  name: string
  defaultBaseURL: string
  keyEnv: string
  urlEnv: string
}) {
  const providerID = Provider.ID.make(options.id)
  return define({
    id: `redcode.provider.${options.id}`,
    effect: Effect.fn(function* (ctx) {
      const credentials = yield* Credential.Service
      const kv = yield* KV.Service
      const bus = yield* Bus.Service
      const loaded: { models: readonly CatalogModel[]; connection?: Connection; digest?: string } = { models: [] }

      const resolve = Effect.fn("RouterProvider.resolve")(function* () {
        const all = (yield* credentials.all()).toReversed()
        const stored = all
          .filter((item) => all.find((candidate) => candidate.integrationID === item.integrationID)?.id === item.id)
          .filter(
            (item) =>
              item.integrationID === Integration.ID.make(options.id) || item.value.metadata?.router === options.id,
          )
          .find((item) => item.value.type === "key" || (item.value.type === "oauth" && item.value.expires > Date.now()))
        const key =
          stored?.value.type === "key"
            ? stored.value.key
            : stored?.value.type === "oauth"
              ? stored.value.access
              : process.env[options.keyEnv]
        if (!key) return
        const baseURL =
          options.id === "red-router"
            ? redRouterEndpoint(stored)
            : routerEndpoint(stored, process.env[options.urlEnv] ?? options.defaultBaseURL)
        if (!baseURL) return
        return {
          baseURL,
          key,
          integrationID: stored?.integrationID ?? Integration.ID.make(providerID),
        } satisfies Connection
      })

      const refresh = Effect.fn("RouterProvider.refresh")(function* () {
        const connection = yield* resolve()
        if (loaded.connection?.baseURL !== connection?.baseURL || loaded.connection?.key !== connection?.key) {
          loaded.models = []
          loaded.digest = undefined
        }
        loaded.connection = connection
        if (!connection) {
          loaded.models = []
          loaded.digest = undefined
          yield* ctx.provider.reload()
          return
        }
        const cacheKey = `${options.id}:models:${Hash.sha256(`${connection.baseURL}\n${connection.key}`)}`
        const count = yield* kv.get(`${cacheKey}:count`)
        if (typeof count === "number" && Number.isSafeInteger(count) && count > 0 && count < 10_000) {
          const chunks = yield* Effect.forEach(
            Array.from({ length: count }, (_, index) => index),
            (index) => kv.get(`${cacheKey}:${index}`),
          )
          const decoded = chunks.map((chunk) =>
            Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Array(catalogModel))(chunk)),
          )
          if (decoded.every((chunk) => chunk !== undefined)) {
            loaded.models = decoded.flatMap((chunk) => chunk ?? [])
            loaded.digest = Hash.sha256(JSON.stringify(loaded.models))
          }
        }
        yield* ctx.provider.reload()
        const response = yield* Effect.tryPromise({
          try: async (signal) => {
            const result = await fetch(`${connection.baseURL}/models`, {
              redirect: "error",
              signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
              headers: { accept: "application/json", authorization: `Bearer ${connection.key}` },
            })
            if (!result.ok) throw new Error(`${options.name} model catalog HTTP ${result.status}`)
            return (await result.json()) as unknown
          },
          catch: (cause) => cause,
        }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(catalog)))
        const current = yield* resolve()
        if (!current || current.baseURL !== connection.baseURL || current.key !== connection.key) return
        const models = response.data.flatMap((item) => {
          const decoded = Schema.decodeUnknownOption(catalogModel)(item)
          return Option.isSome(decoded) ? [decoded.value] : []
        })
        if (response.data.length && !models.length) throw new Error(`${options.name} returned no valid model entries`)
        const digest = Hash.sha256(JSON.stringify(models))
        if (digest === loaded.digest) return
        loaded.models = models
        loaded.digest = digest
        yield* ctx.provider.reload()
        const chunks = Array.from({ length: Math.ceil(loaded.models.length / 100) }, (_, index) =>
          loaded.models.slice(index * 100, (index + 1) * 100),
        )
        yield* Effect.forEach(chunks, (chunk, index) => kv.set(`${cacheKey}:${index}`, chunk), {
          discard: true,
        })
        yield* kv.set(`${cacheKey}:count`, chunks.length)
      })
      const safeRefresh = () =>
        refresh().pipe(
          Effect.catchCause((cause) => Effect.logWarning(`${options.name} model catalog refresh failed`, { cause })),
        )

      yield* ctx.integration.transform((integrations) => {
        integrations.update(providerID, (integration) => (integration.name = options.name))
        integrations.method.update({
          integrationID: providerID,
          method: {
            type: "key",
            label: `${options.name} API key`,
            form: [
              {
                type: "string",
                key: "baseURL",
                title: `${options.name} API URL`,
                description: "The OpenAI-compatible API endpoint, usually ending in /v1.",
                placeholder: options.defaultBaseURL,
                default: process.env[options.urlEnv] ?? options.defaultBaseURL,
                format: "uri",
                required: true,
              },
            ],
          },
        })
        integrations.method.update({ integrationID: providerID, method: { type: "env", names: [options.keyEnv] } })
      })
      yield* ctx.provider.transform((providers) => {
        const connection = loaded.connection
        if (!connection) return
        providers.add({
          info: {
            id: providerID,
            name: options.name,
            integrationID: connection.integrationID,
            activation: "auto",
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: connection.baseURL, provider: providerID },
          },
          models: loaded.models.flatMap((item) => model(item, providerID)),
        })
      })
      yield* bus.subscribe([Credential.Event.Updated, Credential.Event.Switched]).pipe(
        Stream.runForEach(() => safeRefresh()),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.forkScoped(safeRefresh().pipe(Effect.repeat(Schedule.spaced("5 minutes"))), {
        startImmediately: true,
      })
    }),
  })
}

function routerEndpoint(credential: Credential.Info | undefined, fallback: string) {
  const value = credential?.value
  const configured =
    value?.type === "key" && typeof value.configuration?.baseURL === "string"
      ? value.configuration.baseURL
      : typeof value?.metadata?.baseURL === "string"
        ? value.metadata.baseURL
        : fallback
  if (!URL.canParse(configured)) return
  const url = new URL(configured)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/models$/, "") || "/v1"
  return url.href.replace(/\/+$/, "")
}

function model(item: CatalogModel, providerID: Provider.ID): Model.Info[] {
  if (!item.id || IntelligenceEvaluation.isJev(item.id)) return []
  if (item.type !== undefined && !["chat", "llm", "text"].includes(item.type)) return []
  if (item.api_format !== undefined && !["chat-completions", "responses", "openai-responses"].includes(item.api_format))
    return []
  const output = item.output_modalities ?? (item.type === undefined || item.type === "chat" ? ["text"] : [])
  if (!output.includes("text")) return []
  const endpoints = item.supported_endpoints ?? []
  const responses =
    item.api_format === "responses" ||
    item.api_format === "openai-responses" ||
    endpoints.some((value) => /\/?responses$/.test(value))
  const chat = endpoints.length === 0 || endpoints.some((value) => /chat|completions/.test(value))
  if (!responses && !chat) return []
  const context = Math.floor(item.context_length ?? 8_192)
  const limit = Math.floor(item.max_output_tokens ?? 4_096)
  if (context < 1 || limit < 1) return []
  const id = Model.ID.make(item.id)
  const input = item.input_modalities ?? ["text"]
  return [
    {
      ...Model.Info.default(providerID, id),
      name: item.name || item.id,
      package: responses
        ? "@opencode/ai/providers/openai-compatible-responses"
        : "@opencode/ai/providers/openai-compatible",
      settings: { provider: providerID },
      capabilities: {
        tools: item.capabilities?.tool_calling === true,
        reasoning: item.capabilities?.reasoning === true || item.capabilities?.supportsThinking === true,
        ...(item.capabilities?.temperature === undefined ? {} : { temperature: item.capabilities.temperature }),
        input: [...input],
        output: [...output],
      },
      limit: { context, output: Math.min(limit, context) },
    },
  ]
}
