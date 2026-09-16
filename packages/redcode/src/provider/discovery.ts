import { Effect, Schema, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ModelLimit } from "@reddb-io/redcode-core/model-limit"

export const Input = Schema.Struct({ baseURL: Schema.String, apiKey: Schema.String })
export const Limit = Schema.Struct({ context: Schema.Number, output: Schema.Number })
export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  limit: Limit,
  estimated: Schema.Boolean.annotate({
    description:
      "True when the router and the models catalog did not describe this model, so its limits are a conservative guess.",
  }),
})
export const Result = Schema.Struct({ baseURL: Schema.String, models: Schema.Array(Model) })

export type Limit = typeof Limit.Type
export type Result = typeof Result.Type

/**
 * Limits for a model that neither the router nor the models catalog describes. These are a guess,
 * not reported values: they keep proactive compaction working (a zero context disables it) and
 * stay small enough for most routed models. Set the model's limit in config to override them.
 */
export const DEFAULT_LIMIT: Limit = { context: 128_000, output: 8_192 }

/**
 * What a model with a guessed context is given: the default held back by the reserve, so a
 * request sized against it stays under a real limit somewhat smaller than the guess.
 */
export const GUESSED_LIMIT: Limit = {
  context: ModelLimit.conservative(DEFAULT_LIMIT.context),
  output: DEFAULT_LIMIT.output,
}

/** A model list larger than this is refused instead of buffered. */
export const MAX_CATALOG_BYTES = 5 * 1024 * 1024

export type CatalogLimit = (id: string) => { context: number; output?: number } | undefined

export class DiscoveryError extends Schema.TaggedErrorClass<DiscoveryError>()("ProviderDiscoveryError", {
  message: Schema.String,
}) {}

const CONTEXT_FIELDS = ["context_length", "max_context_length", "context_window", "max_input_tokens"] as const
const OUTPUT_FIELDS = ["max_output_tokens", "max_output_length", "max_completion_tokens"] as const
/** OpenRouter reports the serving provider's own limits under `top_provider`. */
const NESTED = "top_provider"

const Catalog = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.optional(Schema.String),
      [NESTED]: Schema.optional(Schema.Unknown),
      ...Object.fromEntries(
        [...CONTEXT_FIELDS, ...OUTPUT_FIELDS].map((field) => [field, Schema.optional(Schema.Unknown)]),
      ),
    }),
  ),
})

const INVALID_URL = "Use an HTTP or HTTPS API URL without credentials, query or fragment."

/**
 * Accepts what people paste from a router dashboard: a missing scheme becomes http, a trailing
 * /models is dropped and a bare host gets /v1. Returns undefined for anything that is not a plain
 * HTTP(S) URL. The TUI mirrors this in util/openai-compatible.ts.
 */
export function normalizeBaseURL(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return
  const url = URL.parse(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`)
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    return
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/models$/, "") || "/v1"
  return url.toString().replace(/\/+$/, "")
}

function positive(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

function firstPositive(item: Record<string, unknown>, fields: readonly string[]) {
  for (const field of fields) {
    const value = positive(item[field])
    if (value) return value
  }
  const nested = item[NESTED]
  if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
    for (const field of fields) {
      const value = positive((nested as Record<string, unknown>)[field])
      if (value) return value
    }
  }
}

/**
 * Router-reported limits win (the serving provider's `top_provider` limits included), then the
 * catalog entry, then the conservative default. A model whose context nobody reports gets the
 * guess held back by the reserve, and the smaller of the router's own and the serving provider's
 * output limit.
 */
export function resolveLimit(item: Record<string, unknown> & { id: string }, catalog?: CatalogLimit) {
  const reported = { context: firstPositive(item, CONTEXT_FIELDS), output: firstPositive(item, OUTPUT_FIELDS) }
  const known = reported.context && reported.output ? undefined : catalog?.(item.id)
  const context = reported.context ?? positive(known?.context)
  const output = reported.output ?? positive(known?.output)
  const limitContext = context ?? GUESSED_LIMIT.context
  return {
    limit: { context: limitContext, output: output ?? Math.min(DEFAULT_LIMIT.output, limitContext) },
    estimated: context === undefined || output === undefined,
  }
}

/**
 * Looks model IDs up in the models catalog. Routers prefix upstream IDs (`cc/claude-...`), so
 * leading path segments are dropped one at a time until an entry with a known context matches.
 */
export function catalogLimits(
  providers: Record<string, { models: Record<string, { limit: { context: number; output: number } }> }>,
): CatalogLimit {
  const index = new Map<string, { context: number; output?: number }>()
  for (const provider of Object.values(providers)) {
    for (const [id, model] of Object.entries(provider.models)) {
      if (index.has(id) || !positive(model.limit.context)) continue
      index.set(id, { context: model.limit.context, output: positive(model.limit.output) })
    }
  }
  return (id) => {
    const parts = id.split("/")
    for (let start = 0; start < parts.length; start++) {
      const hit = index.get(parts.slice(start).join("/"))
      if (hit) return hit
    }
  }
}

/** Redirects followed while fetching a model list. */
export const MAX_REDIRECTS = 5

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

/** Header values must be visible ASCII; anything else would fail as a network error. */
export function validKey(key: string) {
  return /^[\x21-\x7e]+$/.test(key)
}

export type DiscoverInput = {
  baseURL: string
  /** Sent as a bearer token. Optional unless `requireKey` is set. */
  apiKey?: string
  /** Extra request headers, already resolved. Like the key, they never follow a redirect to another origin. */
  headers?: Readonly<Record<string, string>>
}

export const discover = Effect.fn("ProviderDiscovery.discover")(function* (
  http: HttpClient.HttpClient,
  input: DiscoverInput,
  options: { catalog?: CatalogLimit; maxBytes?: number; requireKey?: boolean; emptyMessage?: string } = {},
) {
  const baseURL = normalizeBaseURL(input.baseURL)
  if (!baseURL) return yield* new DiscoveryError({ message: INVALID_URL })
  const apiKey = input.apiKey?.trim() ?? ""
  if (!apiKey && (options.requireKey ?? true))
    return yield* new DiscoveryError({ message: "Enter the API key from your provider dashboard." })
  if (apiKey && !validKey(apiKey)) {
    return yield* new DiscoveryError({
      message: "The API key contains invalid characters. Copy it again from the provider dashboard.",
    })
  }
  const maxBytes = options.maxBytes ?? MAX_CATALOG_BYTES
  const tooLarge = () =>
    new DiscoveryError({ message: "The provider returned a model list that is too large. Check the API URL." })
  const invalid = () =>
    new DiscoveryError({
      message: "The provider returned an invalid model list. Check that this is an OpenAI-compatible API URL.",
    })
  const unreachable = () =>
    new DiscoveryError({
      message: "Cannot reach the provider. Check the API URL and that it is running on the Redcode server's network.",
    })
  const origin = new URL(baseURL).origin
  // Redirects are followed here rather than by fetch, so the key and custom headers are dropped
  // explicitly as soon as a hop leaves the origin the user entered, whatever the runtime does.
  const request = (url: URL, credentials: boolean) => {
    let next = HttpClientRequest.get(url.toString()).pipe(HttpClientRequest.acceptJson)
    if (credentials && apiKey) next = HttpClientRequest.bearerToken(next, apiKey)
    // Configured headers win over the bearer token, as they do for model requests.
    if (credentials && input.headers) next = HttpClientRequest.setHeaders(next, input.headers)
    return http
      .execute(next)
      .pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }), Effect.mapError(unreachable))
  }
  return yield* Effect.gen(function* () {
    let url = new URL(`${baseURL}/models`)
    let credentials = true
    let response = yield* request(url, credentials)
    for (let hops = 0; REDIRECT_STATUS.has(response.status) && response.headers.location; hops++) {
      if (hops >= MAX_REDIRECTS)
        return yield* new DiscoveryError({ message: "The model list redirected too many times. Check the API URL." })
      const target = URL.parse(response.headers.location, url)
      if (!target || !["http:", "https:"].includes(target.protocol) || target.username || target.password)
        return yield* new DiscoveryError({ message: "The model list redirected to an unsupported URL." })
      url = target
      credentials = credentials && target.origin === origin
      response = yield* request(url, credentials)
    }
    if (response.status === 401 || response.status === 403) {
      return yield* new DiscoveryError({
        message: "The provider refused this API key. Copy a valid key from its dashboard and retry.",
      })
    }
    if (response.status !== 200) {
      return yield* new DiscoveryError({
        message: `The model list returned HTTP ${response.status}. Check the API URL, including /v1.`,
      })
    }
    const declared = Number(response.headers["content-length"])
    if (Number.isFinite(declared) && declared > maxBytes) return yield* tooLarge()
    const chunks: Uint8Array[] = []
    let size = 0
    yield* response.stream.pipe(
      Stream.runForEach((chunk) => {
        size += chunk.byteLength
        if (size > maxBytes) return Effect.fail(tooLarge())
        chunks.push(chunk)
        return Effect.void
      }),
      Effect.mapError((error) => (error instanceof DiscoveryError ? error : invalid())),
    )
    const body = yield* Effect.try({
      try: () => JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))) as unknown,
      catch: invalid,
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Catalog)), Effect.mapError(invalid))
    const models = [
      ...new Map(
        body.data
          .filter((model) => validModelID(model.id))
          .map((model) => [
            model.id,
            { id: model.id, name: model.name?.trim() || model.id, ...resolveLimit(model, options.catalog) },
          ]),
      ).values(),
    ]
    if (!models.length) {
      return yield* new DiscoveryError({
        message:
          options.emptyMessage ??
          "No models are available. Connect an account or create a combo in the provider dashboard, then retry.",
      })
    }
    return { baseURL, models }
  }).pipe(
    Effect.timeoutOrElse({
      duration: "10 seconds",
      orElse: () =>
        Effect.fail(
          new DiscoveryError({ message: "The provider took too long to respond. Check the API URL and retry." }),
        ),
    }),
  )
})

/** A model ID that can be a config key: not blank and not an object prototype key. */
export function validModelID(id: string) {
  return !!id.trim() && !["__proto__", "constructor", "prototype"].includes(id)
}

export * as ProviderDiscovery from "./discovery"
