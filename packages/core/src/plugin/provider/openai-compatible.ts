import { define } from "@opencode/plugin/effect/plugin"
import { Form } from "@opencode/schema/form"
import { Effect, Option, Schema } from "effect"
import { Config } from "../../config.js"
import { Integration } from "../../integration.js"
import { ModelLimit } from "../../model-limit.js"
import { ModelsDev } from "../../models-dev.js"
import { catalogLimits, knownLimit, type CatalogLimits } from "./catalog-limits.js"
import { Provider } from "../../provider.js"
import { RemoteCheck } from "../../remote-check.js"
import { ConnectionCheck } from "@opencode/schema/connection-check"

/**
 * The `/connect` wizard for any OpenAI-compatible endpoint. Connecting checks the URL and key by reading the
 * endpoint's `/models`, writes the provider (URL, API, headers, models and limits) into the global configuration,
 * and files the key in the credential store under the new provider's own integration, never in configuration.
 *
 * The URL and the key are all it asks: the models and their limits come from `/models`, and the provider ID and
 * display name come from the host. Everything else sits behind one "customize" question. A limit the endpoint does
 * not report is taken from the models catalog, and one the catalog lacks is guessed and later corrected by the size
 * refusals the provider sends (see `ModelLimit`).
 *
 * An endpoint that turns out to be a RedRouter is not a generic endpoint: it is connected as the RedRouter
 * integration, which reads its own catalog, routes, key role and capabilities.
 */
export const INTEGRATION_ID = Integration.ID.make("openai-compatible")

const CHAT_PACKAGE = "@opencode/ai/providers/openai-compatible"
const RESPONSES_PACKAGE = "@opencode/ai/providers/openai-compatible-responses"
const PROVIDER_ID = "^[a-z0-9][a-z0-9_-]{0,63}$"
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const HEADER_VALUE = /^[\x20-\x7e]*$/
const API_KEY = /^[\x21-\x7e]+$/
// The key travels as a bearer token; a credential header typed here would land in plain configuration.
const SECRET_HEADER = /^(authorization|proxy-authorization|x-api-key|api-key)$/i
const MAX_HEADERS = 32
const MAX_ENTERED_MODELS = 500
/** Limits for a model the endpoint does not describe: a guess that keeps proactive compaction working. */
const DEFAULT_CONTEXT = 128_000
const DEFAULT_OUTPUT = 8_192

/** The fields shown only when the user asks to customize the connection. */
const ADVANCED = [{ key: "advanced", op: "eq" as const, value: true }]

const limitValue = Schema.optional(Schema.NullOr(Schema.Number))
const ListedModel = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  display_name: Schema.optional(Schema.String),
  // OpenAI-compatible servers name their limits differently and some send null for unknown values: `context_length`
  // (OpenRouter, LiteLLM), `context_window`, `max_context_length` and `loaded_context_length` (LM Studio),
  // `max_model_len` (vLLM), `top_provider` (OpenRouter) and `meta.n_ctx_train` (llama.cpp).
  context_length: limitValue,
  context_window: limitValue,
  max_context_length: limitValue,
  loaded_context_length: limitValue,
  max_model_len: limitValue,
  max_output_tokens: limitValue,
  max_completion_tokens: limitValue,
  top_provider: Schema.optional(
    Schema.NullOr(Schema.Struct({ context_length: limitValue, max_completion_tokens: limitValue })),
  ),
  meta: Schema.optional(Schema.NullOr(Schema.Struct({ n_ctx_train: limitValue }))),
})
const ModelList = Schema.Struct({ data: Schema.Array(Schema.Unknown) })

export type Listed = typeof ListedModel.Type

export interface Endpoint {
  readonly providerID: string
  readonly name: string
  readonly baseURL: string
  readonly responses: boolean
  readonly headers: Readonly<Record<string, string>>
  readonly models: ReadonlyArray<string>
  readonly context?: number
  readonly output?: number
}

export const OpenAICompatiblePlugin = define({
  id: "redcode.provider.openai-compatible",
  effect: Effect.fn(function* () {
    const integrations = yield* Integration.Service
    const providers = yield* Provider.Service
    const config = yield* Config.Service

    const freeProviderID = Effect.fn("OpenAICompatible.freeProviderID")(function* (base: string) {
      const taken = Effect.fnUntraced(function* (id: string) {
        const existing = yield* providers.get(Provider.ID.make(id))
        const saved = (yield* config.entries()).some(
          (entry) => entry.type === "document" && typeof entry.info.providers?.[id]?.settings?.baseURL === "string",
        )
        return existing !== undefined && !saved
      })
      for (let attempt = 1; attempt < 50; attempt++) {
        const id = attempt === 1 ? base : `${base.slice(0, 60)}-${attempt}`
        if (!(yield* taken(id))) return id
      }
      return base
    })

    const prepare = Effect.fn("OpenAICompatible.prepare")(function* (input: {
      readonly key: string
      readonly answer: Form.Answer
    }) {
      const parsed = parseEndpoint(input.answer)
      if (typeof parsed === "string") return yield* Effect.fail(new Error(parsed))
      // A provider ID the user did not choose is derived from the host, so it yields to one that is already taken.
      const chosen = text(input.answer.providerID) !== ""
      const endpoint = chosen ? parsed : { ...parsed, providerID: yield* freeProviderID(parsed.providerID) }
      if (!API_KEY.test(input.key))
        return yield* Effect.fail(new Error("The API key must be one word of printable characters"))
      const existing = yield* providers.get(Provider.ID.make(endpoint.providerID))
      const saved = (yield* config.entries()).some(
        (entry) =>
          entry.type === "document" &&
          typeof entry.info.providers?.[endpoint.providerID]?.settings?.baseURL === "string",
      )
      // An endpoint saved with its own base URL is replaced on reconnect; a catalog or plugin provider keeps its ID.
      if (existing && !saved)
        return yield* Effect.fail(
          new Error(`${endpoint.providerID} is already a provider (${existing.name}); choose another provider ID`),
        )
      const listed = yield* discover(endpoint, input.key)
      // A RedRouter keeps everything that makes it special only as the RedRouter integration, whichever way it was added.
      if (yield* isRedRouter(endpoint, input.key))
        return prepared({
          integrationID: Integration.ID.make("red-router"),
          label: endpoint.name,
          configuration: { baseURL: endpoint.baseURL },
        })
      const catalog = yield* Effect.serviceOption(ModelsDev.Service).pipe(
        Effect.flatMap((service) => (Option.isSome(service) ? service.value.get() : Effect.succeed([]))),
        Effect.map(catalogLimits),
        Effect.orElseSucceed(() => catalogLimits([])),
      )
      const provider = providerConfig(endpoint, listed, catalog)
      if (Object.keys(provider.models).length === 0)
        return yield* Effect.fail(
          new Error(
            `${endpoint.baseURL}/models lists no models; customize the connection to enter the model IDs to use`,
          ),
        )
      if (!config.saveProvider) return yield* Effect.fail(new Error("The configuration cannot be written"))
      yield* config.saveProvider(endpoint.providerID, provider)
      return prepared({
        integrationID: Integration.ID.make(endpoint.providerID),
        label: endpoint.name,
        configuration: {},
      })
    })

    yield* integrations.transform((editor) => {
      editor.update(INTEGRATION_ID, (integration) => {
        integration.name = "OpenAI-compatible endpoint"
      })
      editor.method.update({
        integrationID: INTEGRATION_ID,
        method: {
          type: "key",
          label: "API key (any value when the endpoint needs none)",
          form: [
            {
              type: "string",
              key: "baseURL",
              title: "API base URL",
              description: "The OpenAI-compatible endpoint, usually ending in /v1.",
              placeholder: "https://api.example.com/v1",
              format: "uri",
              required: true,
            },
            {
              type: "boolean",
              key: "advanced",
              title: "Customize the connection?",
              description:
                "Models and their limits are read from the endpoint's /models. Say yes to set the provider ID, display name, API, extra headers, model IDs or limits yourself.",
              default: false,
            },
            {
              type: "string",
              key: "providerID",
              title: "Provider ID",
              description:
                "Lowercase letters, numbers, hyphens and underscores. Models are referenced as <provider ID>/<model ID>. Defaults to the host.",
              placeholder: "my-endpoint",
              pattern: PROVIDER_ID,
              when: ADVANCED,
            },
            {
              type: "string",
              key: "name",
              title: "Display name",
              description: "Defaults to the host.",
              when: ADVANCED,
            },
            {
              type: "string",
              key: "api",
              title: "API",
              options: [
                { value: "chat", label: "Chat Completions", description: "/chat/completions" },
                { value: "responses", label: "Responses", description: "/responses" },
              ],
              default: "chat",
              required: true,
              when: ADVANCED,
            },
            {
              type: "string",
              key: "models",
              title: "Model IDs",
              description:
                "Comma-separated IDs added to the ones /models lists. Required when the endpoint has no /models.",
              when: ADVANCED,
            },
            {
              type: "string",
              key: "headers",
              title: "Extra headers",
              description:
                "Name: value pairs separated by semicolons, such as X-Org: acme; X-Env: prod. The API key is sent as a bearer token, so credential headers are not accepted here.",
              when: ADVANCED,
            },
            {
              type: "integer",
              key: "context",
              title: "Context window (tokens)",
              description: "Overrides what the endpoint reports for every model.",
              minimum: 1,
              when: ADVANCED,
            },
            {
              type: "integer",
              key: "output",
              title: "Maximum output tokens",
              description: "Overrides what the endpoint reports for every model.",
              minimum: 1,
              when: ADVANCED,
            },
          ],
        },
        prepare,
      })
    })
  }),
})

/** The wizard's answer as an endpoint, or what is wrong with it. */
export function parseEndpoint(answer: Form.Answer): Endpoint | string {
  const baseURL = normalizeBaseURL(text(answer.baseURL))
  if (!baseURL) return "The API base URL must be an http or https URL without credentials, query or fragment"
  const chosen = text(answer.providerID)
  const providerID = chosen || deriveProviderID(baseURL)
  if (!new RegExp(PROVIDER_ID).test(providerID))
    return "The provider ID must be 1 to 64 lowercase letters, numbers, hyphens or underscores, starting with a letter or number"
  const headers = parseHeaders(text(answer.headers))
  if (typeof headers === "string") return headers
  const models = [
    ...new Set(
      text(answer.models)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
  if (models.length > MAX_ENTERED_MODELS) return `Enter at most ${MAX_ENTERED_MODELS} model IDs`
  const context = limit(answer.context)
  const output = limit(answer.output)
  return {
    providerID,
    name: text(answer.name) || (chosen ? providerID : new URL(baseURL).host),
    baseURL,
    responses: answer.api === "responses",
    headers,
    models,
    ...(context === undefined ? {} : { context }),
    ...(output === undefined ? {} : { output }),
  }
}

/** A provider ID from the endpoint's host, such as `api-example-com` or `localhost-1234`. */
export function deriveProviderID(baseURL: string) {
  const host = URL.canParse(baseURL) ? new URL(baseURL).host : ""
  const id = host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "")
  return id || "endpoint"
}

/** An OpenAI-compatible base URL without a trailing slash or a pasted endpoint path, or undefined when unusable. */
export function normalizeBaseURL(value: string) {
  if (!URL.canParse(value)) return
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/(models|chat\/completions|responses)$/, "")
  return url.href.replace(/\/+$/, "")
}

/** `Name: value; Other: value` as headers, or what is wrong with them. */
export function parseHeaders(value: string): Record<string, string> | string {
  const pairs = value
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
  if (pairs.length > MAX_HEADERS) return `Enter at most ${MAX_HEADERS} headers`
  const entries = pairs.map((pair) => {
    const separator = pair.indexOf(":")
    return {
      pair,
      name: separator > 0 ? pair.slice(0, separator).trim() : "",
      value: pair.slice(separator + 1).trim(),
    }
  })
  const invalid = entries.find((entry) => !HEADER_NAME.test(entry.name) || !HEADER_VALUE.test(entry.value))
  if (invalid) return `Headers must be written as Name: value; this one is not: ${invalid.pair}`
  const secret = entries.find((entry) => SECRET_HEADER.test(entry.name))
  if (secret) return `${secret.name} carries a credential; enter the key as the API key instead`
  return Object.fromEntries(entries.map((entry) => [entry.name, entry.value]))
}

/**
 * Reads `<baseURL>/models` with the key: the connectivity test and model discovery in one request. Entered
 * model IDs make a missing or unreadable model list acceptable, but never a rejected key or an unreachable host.
 */
export const discover = Effect.fn("OpenAICompatible.discover")(function* (endpoint: Endpoint, key: string) {
  const url = `${endpoint.baseURL}/models`
  const requests: ConnectionCheck.Request[] = []
  const failure = (message: string) =>
    Object.assign(new Error(`${message}\n\n${ConnectionCheck.describe(requests)}`), { requests })
  const response = yield* Effect.tryPromise({
    try: async (signal) => {
      const result = await RemoteCheck.request(
        url,
        {
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          headers: { ...endpoint.headers, accept: "application/json", authorization: `Bearer ${key}` },
        },
        requests,
      )
      return { status: result.status, ok: result.ok, body: result.ok ? await result.text() : "" }
    },
    catch: (cause) => failure(`Could not reach ${url}: ${cause instanceof Error ? cause.message : String(cause)}`),
  })
  if (response.status === 401 || response.status === 403)
    return yield* Effect.fail(failure(`The endpoint rejected the API key (HTTP ${response.status})`))
  const list = response.ok
    ? Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(ModelList))(response.body))
    : undefined
  if (!list) {
    if (endpoint.models.length > 0) return []
    return yield* Effect.fail(
      failure(
        response.ok
          ? `${url} did not return an OpenAI model list; customize the connection to enter the model IDs to use`
          : `${url} answered HTTP ${response.status}; check the URL, or customize the connection to enter the model IDs to use`,
      ),
    )
  }
  const models = list.data.flatMap((item) => Option.toArray(Schema.decodeUnknownOption(ListedModel)(item)))
  requests[requests.length - 1].models = models.length
  yield* Effect.logInfo("OpenAI-compatible catalog checked", { requests })
  return models
})

/**
 * Whether the endpoint is a RedRouter, by the capabilities document the router publishes about itself, or by serving
 * only System One models on `/models/systemone` as older routers do. Best effort: an endpoint that does not answer, or
 * answers with anything else, is not one.
 */
export const isRedRouter = Effect.fn("OpenAICompatible.isRedRouter")(function* (endpoint: Endpoint, key: string) {
  const get = (route: string) =>
    fetch(`${endpoint.baseURL}/${route}`, {
      redirect: "error",
      signal: AbortSignal.timeout(3_000),
      headers: { ...endpoint.headers, accept: "application/json", authorization: `Bearer ${key}` },
    })
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : undefined))
      .catch(() => undefined)
  const capabilities = yield* Effect.promise(() => get("capabilities"))
  if (isRecord(capabilities) && capabilities.product === "red-router") return true
  const systemOne = yield* Effect.promise(() => get("models/systemone"))
  const data = isRecord(systemOne) ? systemOne.data : undefined
  const ids = Array.isArray(data)
    ? data.flatMap((item) => (isRecord(item) && typeof item.id === "string" ? [item.id] : []))
    : []
  return ids.length > 0 && ids.every((id) => /\bjev\b/i.test(id))
})

// Declared, not inferred: two returned object literals would gain `?: undefined` members that the form answer rejects.
const prepared = (value: Integration.KeyPrepared): Integration.KeyPrepared => value

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

/** The provider as written under `providers.<id>` in the global configuration. */
export function providerConfig(endpoint: Endpoint, listed: ReadonlyArray<Listed>, catalog?: CatalogLimits) {
  const byID = new Map(listed.filter((model) => model.id.trim()).map((model) => [model.id, model]))
  const ids = [...new Set([...byID.keys(), ...endpoint.models])]
  return {
    name: endpoint.name,
    package: endpoint.responses ? RESPONSES_PACKAGE : CHAT_PACKAGE,
    settings: { baseURL: endpoint.baseURL, provider: endpoint.providerID },
    ...(Object.keys(endpoint.headers).length ? { headers: { ...endpoint.headers } } : {}),
    models: Object.fromEntries(
      ids.map((id) => {
        const model = byID.get(id)
        const display = model?.display_name?.trim() || model?.name?.trim()
        const known = catalog ? knownLimit(catalog, id) : undefined
        const context =
          endpoint.context ??
          positive([
            model?.context_length,
            model?.context_window,
            model?.max_context_length,
            model?.loaded_context_length,
            model?.max_model_len,
            model?.top_provider?.context_length,
            model?.meta?.n_ctx_train,
          ]) ??
          known?.context ??
          ModelLimit.conservative(DEFAULT_CONTEXT)
        const output = Math.min(
          endpoint.output ??
            positive([
              model?.max_completion_tokens,
              model?.max_output_tokens,
              model?.top_provider?.max_completion_tokens,
            ]) ??
            known?.output ??
            DEFAULT_OUTPUT,
          context,
        )
        return [id, { name: display || id, limit: { context, output } }] as const
      }),
    ),
  }
}

function text(value: Form.Value | undefined) {
  return typeof value === "string" ? value.trim() : ""
}

function limit(value: Form.Value | undefined) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function positive(values: ReadonlyArray<number | null | undefined>) {
  const value = values.find(
    (candidate): candidate is number => typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0,
  )
  return value === undefined ? undefined : Math.floor(value)
}
