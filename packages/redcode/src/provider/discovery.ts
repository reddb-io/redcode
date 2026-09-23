import { Effect, Schema, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ModelLimit } from "@reddb-io/redcode-core/model-limit"
import { ProviderRouter } from "@reddb-io/redcode-core/provider/router"
import { ConfigProviderV1 } from "@reddb-io/redcode-core/v1/config/provider"
import { Router } from "@reddb-io/redcode-schema/router"
import { isRecord } from "@/util/record"

export const Input = Schema.Struct({ baseURL: Schema.String, apiKey: Schema.String })
export const Limit = Schema.Struct({ context: Schema.Number, output: Schema.Number })
/**
 * What a router says about a model beyond its limits: RedRouter lists combos, their members,
 * thinking levels and the parameters a request must respect.
 */
export const RouterInfo = Schema.Struct({
  owned_by: Schema.optional(Schema.String),
  strategy: Schema.optional(Schema.String).annotate({ description: "How a combo walks its members." }),
  thinking_levels: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Reasoning levels the router accepts for this model; they become its variants.",
  }),
  capabilities: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  parameters: Schema.optional(ConfigProviderV1.RouterParameters),
  members: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "The provider/model ids a combo can route to, nested combos expanded.",
  }),
})
export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  limit: Limit,
  estimated: Schema.Boolean.annotate({
    description:
      "True when the router and the models catalog did not describe this model, so its limits are a conservative guess.",
  }),
  router: Schema.optional(RouterInfo),
})
export const Result = Schema.Struct({
  baseURL: Schema.String,
  models: Schema.Array(Model),
  router: Schema.optional(Router.Detection).annotate({
    description: "What answered at the URL, probed after connecting. Absent when the probe was not run.",
  }),
  catalogVersion: Schema.optional(Schema.String).annotate({
    description: "The catalog version RedRouter reported with the model list, when it did.",
  }),
})

export type Limit = typeof Limit.Type
export type RouterInfo = typeof RouterInfo.Type
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
      owned_by: Schema.optional(Schema.Unknown),
      strategy: Schema.optional(Schema.Unknown),
      thinking_levels: Schema.optional(Schema.Unknown),
      capabilities: Schema.optional(Schema.Unknown),
      parameters: Schema.optional(Schema.Unknown),
      members: Schema.optional(Schema.Unknown),
      [NESTED]: Schema.optional(Schema.Unknown),
      ...Object.fromEntries(
        [...CONTEXT_FIELDS, ...OUTPUT_FIELDS].map((field) => [field, Schema.optional(Schema.Unknown)]),
      ),
    }),
  ),
})

const INVALID_URL = "Use an HTTP or HTTPS API URL without credentials, query or fragment."

/**
 * True for hosts that are only reachable locally: loopback, private (RFC 1918) and unique local
 * IPv6 addresses, `localhost`, `*.local` and single-label names such as a container's name.
 */
export function isLocalHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true
  if (host.includes(":")) return host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host)
  const ip = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host)
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])]
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  return !host.includes(".")
}

/**
 * Accepts what people paste from a dashboard: a missing scheme becomes http for a local host and
 * https for anything else (so a key is never sent in cleartext to a public host by default), a
 * trailing /models is dropped and a bare host gets /v1. Returns undefined for anything that is not
 * a plain HTTP(S) URL. The TUI mirrors this in util/openai-compatible.ts.
 */
export function normalizeBaseURL(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return
  const schemeless = !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  const probe = schemeless ? URL.parse(`http://${trimmed}`) : undefined
  const url = URL.parse(
    schemeless ? `${probe && !isLocalHost(probe.hostname) ? "https" : "http"}://${trimmed}` : trimmed,
  )
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
 * Router-reported limits win (RedRouter's `parameters` first, a combo's being its strictest
 * member's, then the serving provider's `top_provider` limits), then the catalog entry, then the
 * conservative default. A model whose context nobody reports gets the guess held back by the
 * reserve, and the smaller of the router's own and the serving provider's output limit.
 */
export function resolveLimit(item: Record<string, unknown> & { id: string }, catalog?: CatalogLimit) {
  const parameters = isRecord(item.parameters) ? item.parameters : {}
  const reported = {
    context: positive(parameters.context_length) ?? firstPositive(item, CONTEXT_FIELDS),
    output: positive(parameters.max_completion_tokens) ?? firstPositive(item, OUTPUT_FIELDS),
  }
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
          .map((model) => {
            const router = routerInfo(model)
            return [
              model.id,
              {
                id: model.id,
                name: model.name?.trim() || model.id,
                ...resolveLimit(model, options.catalog),
                ...(router ? { router } : {}),
              },
            ] as const
          }),
      ).values(),
    ]
    if (!models.length) {
      return yield* new DiscoveryError({
        message:
          options.emptyMessage ??
          "No models are available. Connect an account or create a combo in the provider dashboard, then retry.",
      })
    }
    const catalogVersion = ProviderRouter.header(response.headers, ProviderRouter.Header.catalogVersion)
    return { baseURL, models, ...(catalogVersion ? { catalogVersion } : {}) }
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

/**
 * The router fields of a model list entry. `owned_by` alone is every OpenAI-compatible server's
 * boilerplate, so it is kept only for a combo or next to another router field.
 */
export function routerInfo(item: Record<string, unknown>): RouterInfo | undefined {
  const parameters = routerParameters(item.parameters)
  // A combo's own levels are already what all its members accept; parameters say the same.
  const levels = strings(item.thinking_levels) ?? strings(parameters?.thinking_levels)
  const members = strings(item.members)
  const info = {
    ...(typeof item.strategy === "string" && item.strategy ? { strategy: item.strategy } : {}),
    ...(levels?.length ? { thinking_levels: levels } : {}),
    ...(isRecord(item.capabilities) ? { capabilities: item.capabilities } : {}),
    ...(parameters ? { parameters } : {}),
    ...(members?.length ? { members } : {}),
  }
  const owner = typeof item.owned_by === "string" && item.owned_by ? item.owned_by : undefined
  if (owner && (owner === "combo" || Object.keys(info).length)) return { owned_by: owner, ...info }
  return Object.keys(info).length ? info : undefined
}

/**
 * RedRouter's `parameters`, keeping only fields of the documented type so a malformed value never
 * reaches (and invalidates) the configuration file. Unknown fields are dropped.
 */
function routerParameters(value: unknown): ConfigProviderV1.RouterParameters | undefined {
  if (!isRecord(value)) return
  const flag = (item: unknown) => (typeof item === "boolean" ? item : undefined)
  const modalities = isRecord(value.modalities) ? value.modalities : {}
  const io = defined({ input: strings(modalities.input), output: strings(modalities.output) })
  const parameters = defined({
    context_length: positive(value.context_length),
    max_completion_tokens: positive(value.max_completion_tokens),
    reasoning: flag(value.reasoning),
    // null is meaningful: the model takes no thinking level at all.
    thinking_levels: value.thinking_levels === null ? null : strings(value.thinking_levels),
    thinking_can_disable: flag(value.thinking_can_disable),
    forced_tool_choice: flag(value.forced_tool_choice),
    tools: flag(value.tools),
    search: flag(value.search),
    modalities: Object.keys(io).length ? io : undefined,
  })
  return Object.keys(parameters).length ? parameters : undefined
}

function defined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }
}

/** The distinct non-blank strings of an array; undefined for anything that is not an array. */
function strings(value: unknown) {
  if (!Array.isArray(value)) return
  return [...new Set(value.filter((item): item is string => typeof item === "string" && !!item.trim()))]
}

/** A model ID that can be a config key: not blank and not an object prototype key. */
export function validModelID(id: string) {
  return !!id.trim() && !["__proto__", "constructor", "prototype"].includes(id)
}

export * as ProviderDiscovery from "./discovery"
