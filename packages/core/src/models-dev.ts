import { Cause, Context, Duration, Effect, Layer, Option, Schedule, Schema, Semaphore } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ModelsDev } from "@opencode/schema/models-dev"
import { Money } from "@opencode/schema/money"
import { App } from "./app.js"
import { Hash } from "@opencode/util/hash"
import { FSUtil } from "@opencode/util/fs-util"
import { Bus } from "./bus.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { Model } from "./model.js"
import { AISDKNative } from "./aisdk-native.js"
import { Provider } from "./provider.js"
import { Variant } from "./variant.js"
import { KV } from "./kv.js"
import snapshotText from "./models-dev/snapshot.txt" with { type: "text" }

export const CatalogModelStatus = Schema.Literals(["alpha", "beta", "deprecated"])
export type CatalogModelStatus = typeof CatalogModelStatus.Type

type Cost = {
  readonly input: Money.USDPerMillionTokens
  readonly output: Money.USDPerMillionTokens
  readonly cache_read?: Money.USDPerMillionTokens
  readonly cache_write?: Money.USDPerMillionTokens
  readonly tiers?: readonly (Cost & { readonly tier: { readonly type: "context"; readonly size: number } })[]
  readonly context_over_200k?: Omit<Cost, "tiers" | "context_over_200k">
}

type Modality = "text" | "audio" | "image" | "video" | "pdf"

type SourceModel = {
  readonly id: string
  readonly name: string
  readonly family?: string
  readonly release_date: string
  readonly attachment: boolean
  readonly reasoning: boolean
  readonly reasoning_options?: readonly (
    | { readonly type: "effort"; readonly values: readonly (string | null)[] }
    | Exclude<Variant.Support, { type: "effort" }>
  )[]
  readonly temperature?: boolean
  readonly tool_call: boolean
  readonly interleaved?: boolean | string | { readonly field: string }
  readonly cost?: Cost
  readonly limit: { readonly context: number; readonly input?: number; readonly output: number }
  readonly modalities?: { readonly input: readonly Modality[]; readonly output: readonly Modality[] }
  readonly experimental?: {
    readonly modes?: Readonly<
      Record<
        string,
        {
          readonly cost?: Cost
          readonly provider?: {
            readonly body?: Provider.Settings
            readonly headers?: Readonly<Record<string, string>>
          }
        }
      >
    >
  }
  readonly status?: CatalogModelStatus
  readonly provider?: { readonly npm?: string; readonly api?: string }
}

type SourceProvider = {
  readonly api?: string
  readonly name: string
  readonly env: readonly string[]
  readonly id: string
  readonly npm: string
  readonly models: Readonly<Record<string, SourceModel>>
}

export type Snapshot = {
  readonly info: Provider.Info
  readonly models: readonly Model.Info[]
  readonly environment: readonly string[]
}

function nativePackage(provider: SourceProvider, model?: SourceModel) {
  const npm = model?.provider?.npm ?? provider.npm
  return AISDKNative.native(npm, { providerID: provider.id, modelID: model?.id }) ?? Provider.aisdk(npm)
}

function normalize(input: Record<string, SourceProvider>): readonly Snapshot[] {
  const providers: Snapshot[] = []
  for (const item of Object.values(input)) {
    const providerID = Provider.ID.make(item.id)
    const packageName = nativePackage(item)
    const info = {
      id: providerID,
      name: item.name,
      activation: "auto",
      package: packageName,
      ...(item.api && packageName !== "@opencode/ai/providers/cloudflare-workers-ai"
        ? { settings: { baseURL: item.api } }
        : {}),
    } satisfies Provider.Info
    const models: Model.Info[] = []
    for (const model of Object.values(item.models)) {
      const baseCost = cost(model.cost)
      const id = Model.ID.make(model.id)
      const base = modelInfo(item, id, model, { cost: baseCost })
      const variants = model.reasoning
        ? Variant.resolve({ ...base, package: nativePackage(item, model) }, supports(model))
        : []
      models.push({
        ...base,
        variants,
        ...(variants.length ? { reasoningVariantIDs: variants.map((variant) => variant.id) } : {}),
      })
      for (const [mode, options] of Object.entries(model.experimental?.modes ?? {})) {
        const modeID = Model.ID.make(`${model.id}-${mode}`)
        models.push(
          modelInfo(item, modeID, model, {
            name: modeName(model, mode),
            cost: mergeCost(baseCost, options.cost),
            request: options.provider,
            variants,
          }),
        )
      }
    }
    providers.push({ info, models, environment: [...item.env] })
  }
  return providers
}

function released(date: string) {
  const time = Date.parse(date)
  return Number.isFinite(time) ? time : 0
}

function cost(input: SourceModel["cost"]): Model.Info["cost"] {
  const base = {
    input: input?.input ?? Money.USDPerMillionTokens.zero,
    output: input?.output ?? Money.USDPerMillionTokens.zero,
    cache: {
      read: input?.cache_read ?? Money.USDPerMillionTokens.zero,
      write: input?.cache_write ?? Money.USDPerMillionTokens.zero,
    },
  }
  return [
    base,
    ...(input?.tiers?.map((item) => ({
      tier: item.tier,
      input: item.input,
      output: item.output,
      cache: {
        read: item.cache_read ?? Money.USDPerMillionTokens.zero,
        write: item.cache_write ?? Money.USDPerMillionTokens.zero,
      },
    })) ?? []),
    ...(input?.context_over_200k
      ? [
          {
            tier: { type: "context" as const, size: 200_000 },
            input: input.context_over_200k.input,
            output: input.context_over_200k.output,
            cache: {
              read: input.context_over_200k.cache_read ?? Money.USDPerMillionTokens.zero,
              write: input.context_over_200k.cache_write ?? Money.USDPerMillionTokens.zero,
            },
          },
        ]
      : []),
  ]
}

function mergeCost(base: Model.Info["cost"], override: SourceModel["cost"] | undefined) {
  if (!override) return base
  const next = cost(override)
  const [baseDefault, ...baseTiers] = base
  const [nextDefault, ...nextTiers] = next
  const tierKey = (item: Model.Info["cost"][number]) => `${item.tier?.type ?? "base"}:${item.tier?.size ?? 0}`
  const merge = (left: Model.Info["cost"][number], right: Model.Info["cost"][number]) => ({
    ...left,
    ...right,
    tier: right.tier ?? left.tier,
    cache: { ...left.cache, ...right.cache },
  })
  const tiers = new Map(baseTiers.map((item) => [tierKey(item), item]))
  for (const item of nextTiers) {
    const current = tiers.get(tierKey(item))
    tiers.set(tierKey(item), current ? merge(current, item) : item)
  }
  return [
    merge(
      baseDefault ?? {
        input: Money.USDPerMillionTokens.zero,
        output: Money.USDPerMillionTokens.zero,
        cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
      },
      nextDefault,
    ),
    ...tiers.values(),
  ]
}

function modeName(model: SourceModel, mode: string) {
  return `${model.name} ${mode.charAt(0).toUpperCase()}${mode.slice(1)}`
}

function supports(model: SourceModel): readonly Variant.Support[] {
  return (model.reasoning_options ?? []).map((option) =>
    option.type === "effort"
      ? { type: "effort", values: option.values.filter((value): value is string => value !== null && value !== "null") }
      : option,
  )
}

function modelInfo(
  provider: SourceProvider,
  id: Model.ID,
  model: SourceModel,
  input: {
    readonly name?: string
    readonly cost?: Model.Info["cost"]
    readonly request?: NonNullable<NonNullable<SourceModel["experimental"]>["modes"]>[string]["provider"]
    readonly variants?: NonNullable<Model.Info["variants"]>
  } = {},
): Model.Info {
  const providerID = Provider.ID.make(provider.id)
  const pkg = model.provider?.npm ? nativePackage(provider, model) : undefined
  // Per model, so it never merges into a model that overrides to a different package.
  const settings = {
    ...(model.provider?.api ? { baseURL: model.provider.api } : {}),
    ...(nativePackage(provider, model) === "@opencode/ai/providers/openai-compatible" ? { provider: providerID } : {}),
  }
  return {
    id,
    modelID: Model.ID.make(model.id),
    providerID,
    name: input.name ?? model.name,
    compatibility: Model.compatibility(model.interleaved),
    family: model.family ? Model.Family.make(model.family) : undefined,
    package: pkg,
    settings: Object.keys(settings).length === 0 ? undefined : settings,
    capabilities: {
      tools: model.tool_call,
      ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
      reasoning: model.reasoning,
      input: [...(model.modalities?.input ?? [])],
      output: [...(model.modalities?.output ?? [])],
    },
    variants: [...(input.variants ?? [])],
    ...(input.variants?.length ? { reasoningVariantIDs: input.variants.map((variant) => variant.id) } : {}),
    time: { released: released(model.release_date) },
    cost: (input.cost ?? cost(model.cost)).map((item) => ({
      ...item,
      tier: item.tier && { ...item.tier },
      cache: { ...item.cache },
    })),
    status: model.status ?? "active",
    enabled: true,
    limit: { context: model.limit.context, input: model.limit.input, output: model.limit.output },
    headers: input.request?.headers ? { ...input.request.headers } : undefined,
    body: input.request?.body ? { ...input.request.body } : undefined,
  }
}

export { Event } from "@opencode/schema/models-dev"

export interface Interface {
  readonly get: () => Effect.Effect<readonly Snapshot[]>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
}

export const Options = Schema.Struct({
  /** `REDCODE_MODELS_URL`, tried before every other source. */
  url: Schema.optional(Schema.String),
  /** The global `models.sources` configuration, tried before the public catalogs. */
  sources: Schema.optional(Schema.Array(Schema.String)),
  file: Schema.optional(Schema.String),
  fetch: Schema.optional(Schema.Boolean),
  snapshot: Schema.optional(Schema.Boolean),
})
export type Options = typeof Options.Type

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelsDev") {}

const CatalogJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
const decodeCatalog = (text: string) =>
  Schema.decodeUnknownEffect(CatalogJson)(text).pipe(Effect.map((catalog) => catalog as Record<string, SourceProvider>))
const Cache = Schema.Struct({
  updatedAt: Schema.Number,
  // Digest of the raw body, persisted so refresh() can skip republishing a
  // byte-identical catalog. Optional for entries written before it existed.
  digest: Schema.optional(Schema.String),
  body: CatalogJson,
})
const CACHE_KEY = "models-dev:catalog"
const STATE_KEY = "models-dev:sources"
/** Public catalogs, tried after `REDCODE_MODELS_URL` and the `models.sources` configuration. */
export const DEFAULT_SOURCES = ["https://models.opencode.ai/api.json", "https://models.dev/api.json"] as const

/** Catalog URLs in the order they are tried: a URL without a `.json` path gets `/api.json`, duplicates go. */
export function sources(configured: readonly (string | undefined)[]) {
  const urls = [...configured, ...DEFAULT_SOURCES].flatMap((value) => {
    const url = value?.trim() ? URL.parse(value.trim()) : null
    if (!url) return []
    if (!url.pathname.endsWith(".json")) url.pathname = `${url.pathname.replace(/\/+$/, "")}/api.json`
    return [url.toString()]
  })
  return [...new Set(urls)]
}

/** Statuses that mean a network policy refuses the source, not a transient outage. */
const BLOCKED_STATUS = new Set([401, 403, 407, 451])
const BLOCKED_ERROR = /proxy|certificate|cert_|self[- ]signed|tls|ssl|unable to (get|verify)/i
const BACKOFF = [Duration.hours(1), Duration.hours(6), Duration.hours(24)]
const MAX_BACKOFF = Duration.toMillis(Duration.hours(24))

/** How long a source is skipped after its first, second and later consecutive blocked attempts. */
export function backoff(failures: number) {
  return Duration.toMillis(BACKOFF[Math.min(Math.max(failures, 1), BACKOFF.length) - 1])
}

/**
 * Whether a request failure looks like a network block (proxy or TLS interception), read from the
 * messages and codes of the error and its causes, never from stack frames.
 */
export function classifyError(error: unknown): { blocked: boolean; reason: string } {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    const record = current as Record<string, unknown>
    if (typeof record.message === "string" && record.message) parts.push(record.message)
    if (typeof record.code === "string" && record.code) parts.push(record.code)
    current = record.cause ?? (typeof record.reason === "object" ? record.reason : undefined)
  }
  if (typeof error === "string") parts.push(error)
  return {
    blocked: parts.some((part) => BLOCKED_ERROR.test(part)),
    reason: parts[0]?.split("\n")[0]?.trim() || "request failed",
  }
}

const SourceState = Schema.Struct({
  failures: Schema.Number,
  blockedUntil: Schema.optional(Schema.Number),
  reason: Schema.optional(Schema.String),
})
const StateJson = Schema.fromJsonString(
  Schema.Struct({
    source: Schema.optional(Schema.String),
    fetchedAt: Schema.optional(Schema.Number),
    sources: Schema.Record(Schema.String, SourceState),
  }),
)
export type SourcesState = {
  source?: string
  fetchedAt?: number
  sources: Record<string, { failures: number; blockedUntil?: number; reason?: string }>
}

/**
 * The persisted source backoff. Malformed state reads as empty, and `blockedUntil` is capped at now + 24h
 * so a clock that was wrong when it was written cannot block a source for longer.
 */
export function decodeState(value: unknown, now = Date.now()): SourcesState {
  const decoded = Schema.decodeUnknownOption(StateJson)(value)
  if (Option.isNone(decoded)) return { sources: {} }
  return {
    ...(decoded.value.source === undefined ? {} : { source: decoded.value.source }),
    ...(decoded.value.fetchedAt === undefined ? {} : { fetchedAt: decoded.value.fetchedAt }),
    sources: Object.fromEntries(
      Object.entries(decoded.value.sources).map(([url, entry]) => [
        url,
        {
          failures: Math.max(0, Math.floor(entry.failures)),
          ...(entry.blockedUntil === undefined
            ? {}
            : { blockedUntil: Math.min(entry.blockedUntil, now + MAX_BACKOFF) }),
          ...(entry.reason === undefined ? {} : { reason: entry.reason }),
        },
      ]),
    ),
  }
}

type Outcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly blocked: boolean; readonly reason: string }

// Bundled snapshot of https://models.opencode.ai/api.json, committed at
// packages/core/src/models-dev/snapshot.txt and refreshed via
// `bun run script/update-models-snapshot.ts`. Decoded and normalized once per
// isolate: the snapshot is a multi-MB module-level constant and one isolate can
// host many runtimes (Cloudflare colocates Durable Object instances), so
// per-runtime decoding would multiply the cost.
let bundledCache: readonly Snapshot[] | undefined
const bundledSnapshot = Effect.suspend(() =>
  bundledCache
    ? Effect.succeed(bundledCache)
    : decodeCatalog(snapshotText).pipe(
        Effect.map((catalog) => {
          bundledCache = normalize(catalog)
          return bundledCache
        }),
      ),
)

export const bundled = bundledSnapshot

export function bodyDigest(text: string) {
  return Hash.sha256(text)
}

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const bus = yield* Bus.Service
      const app = yield* App.Metadata
      const kv = yield* KV.Service
      // Statuses are classified per source below, so a refused source is skipped rather than retried.
      const http = (yield* HttpClient.HttpClient).pipe(
        HttpClient.retryTransient({
          retryOn: "errors-and-responses",
          times: 2,
          schedule: Schedule.exponential(200).pipe(Schedule.jittered),
        }),
      )

      const list = sources([options?.url, ...(options?.sources ?? [])])
      const fetch = options?.fetch ?? true
      const userAgent = App.useragent(app)
      const ttl = Duration.minutes(5)
      const lock = Semaphore.makeUnsafe(1)

      const loadFromCache = Effect.fnUntraced(function* () {
        const value = yield* kv.get(CACHE_KEY)
        const cached = Schema.decodeUnknownOption(Cache)(value)
        if (Option.isSome(cached))
          return {
            catalog: cached.value.body as Record<string, SourceProvider>,
            updatedAt: cached.value.updatedAt,
            digest: cached.value.digest,
          }
        if (value !== undefined) yield* kv.remove(CACHE_KEY)
      })

      const attempt = (url: string): Effect.Effect<Outcome> =>
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeader("User-Agent", userAgent),
          http.execute,
          Effect.flatMap(
            (res): Effect.Effect<Outcome, unknown> =>
              res.status < 200 || res.status >= 300
                ? Effect.succeed<Outcome>({
                    ok: false,
                    blocked: BLOCKED_STATUS.has(res.status),
                    reason: `HTTP ${res.status}`,
                  })
                : res.text.pipe(
                    Effect.flatMap((text) =>
                      decodeCatalog(text).pipe(
                        Effect.map((catalog): Outcome =>
                          Object.keys(catalog).length > 0
                            ? { ok: true, text }
                            : { ok: false, blocked: true, reason: "response is not a models catalog" },
                        ),
                        // A 200 that is not a catalog is a captive portal or a proxy block page.
                        Effect.orElseSucceed(
                          (): Outcome => ({ ok: false, blocked: true, reason: "response is not a models catalog" }),
                        ),
                      ),
                    ),
                  ),
          ),
          Effect.timeout("30 seconds"),
          Effect.catch((error) => Effect.succeed<Outcome>({ ok: false, ...classifyError(error) })),
        )

      const readState = kv.get(STATE_KEY).pipe(Effect.map((value) => decodeState(value)))
      const writeState = (state: SourcesState) =>
        kv.set(STATE_KEY, JSON.stringify(state)).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            (cause) => Effect.logWarning("Failed to save the models catalog source state", { cause }),
          ),
        )

      // Tries every source that is not backing off (all of them when forced) and persists the outcome.
      // Callers hold the lock, so the state has a single writer in this process.
      const fetchChain = Effect.fn("ModelsDev.fetchChain")(function* (force: boolean) {
        const state = yield* readState
        const now = Date.now()
        for (const url of list) {
          const previous = state.sources[url]
          if (!force && previous?.blockedUntil !== undefined && previous.blockedUntil > now) continue
          const outcome = yield* attempt(url)
          if (outcome.ok) {
            if (previous?.blockedUntil !== undefined)
              yield* Effect.logInfo("Models catalog source reachable again", { source: url })
            yield* writeState({
              source: url,
              fetchedAt: now,
              sources: Object.fromEntries(Object.entries(state.sources).filter(([key]) => key !== url)),
            })
            return outcome.text
          }
          if (!outcome.blocked) {
            yield* Effect.logDebug("Models catalog source failed", { source: url, reason: outcome.reason })
            continue
          }
          const failures = (previous?.failures ?? 0) + 1
          const wait = backoff(failures)
          state.sources[url] = { failures, blockedUntil: now + wait, reason: outcome.reason }
          // Warn once when a source becomes blocked; later failures stay quiet until it recovers.
          if (previous?.blockedUntil === undefined)
            yield* Effect.logWarning(
              `Models catalog source ${url} is blocked (${outcome.reason}); using the cached or bundled catalog and retrying in ${Math.round(wait / 3_600_000)}h. On a restricted network set REDCODE_MODELS_URL or "models": { "sources": [...] } in the global config to a reachable mirror.`,
            )
          else yield* Effect.logDebug("Models catalog source still blocked", { source: url, reason: outcome.reason })
        }
        yield* writeState(state)
        return undefined
      })

      const loadFromFile = options?.file
        ? fs.readJson(options.file).pipe(
            Effect.map((input) => input as Record<string, SourceProvider>),
            Effect.orElseSucceed(() => undefined),
          )
        : Effect.undefined

      // The bundled snapshot is the boot-time floor for the catalog; the
      // periodic fetch below still refreshes on top.
      const loadSnapshot = options?.snapshot === false ? Effect.undefined : bundledSnapshot

      // Best-effort: a cache-write failure must never kill catalog
      // population. The payload has outgrown some KV backends' per-value
      // limits (Durable Object SQLite caps values at 2 MB and api.json
      // passed it in Aug 2026); a boot without a cache hit just refetches.
      const writeCache = Effect.fn("ModelsDev.writeCache")(function* (text: string, digest = bodyDigest(text)) {
        yield* kv.set(CACHE_KEY, { updatedAt: Date.now(), digest, body: text }).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            (cause) => Effect.logWarning("Failed to cache models.dev catalog", { cause }),
          ),
        )
      })

      const fetchAndWrite = Effect.fn("ModelsDev.fetchAndWrite")(function* () {
        const text = yield* fetchChain(false)
        // No source answered and there is no cache or bundled catalog: start empty; the refresh retries.
        const empty: Record<string, SourceProvider> = {}
        if (text === undefined) return empty
        const catalog = yield* decodeCatalog(text)
        yield* writeCache(text)
        return catalog
      })

      const populate = Effect.gen(function* () {
        const fromFile = yield* loadFromFile
        if (fromFile) return normalize(fromFile)
        const cached = options?.file ? undefined : yield* loadFromCache()
        if (cached) return normalize(cached.catalog)
        const bundled = yield* loadSnapshot
        if (bundled) return bundled
        if (!fetch) return []
        const catalog = yield* lock.withPermit(
          Effect.gen(function* () {
            const stored = options?.file ? undefined : yield* loadFromCache()
            if (stored) return stored.catalog
            return yield* fetchAndWrite()
          }),
        )
        return normalize(catalog)
      }).pipe(Effect.withSpan("ModelsDev.populate"), Effect.orDie)

      const [cachedGet, invalidate] = yield* Effect.cachedInvalidateWithTTL(populate, Duration.infinity)

      const get = (): Effect.Effect<readonly Snapshot[]> => cachedGet

      const refresh = Effect.fn("ModelsDev.refresh")(function* (force = false) {
        yield* lock
          .withPermit(
            Effect.gen(function* () {
              const stored = yield* loadFromCache()
              if (!force && stored && Date.now() - stored.updatedAt < Duration.toMillis(ttl)) return
              // Blocked sources are skipped until their backoff ends; a block page never replaces the cache.
              const text = yield* fetchChain(force)
              if (text === undefined) return
              const digest = bodyDigest(text)
              // models.dev rarely changes between polls; skip the cache write,
              // invalidation, and Refreshed event for a byte-identical body so
              // downstream provider/model update listeners stay quiet.
              if (!force && stored?.digest === digest) return
              yield* decodeCatalog(text)
              yield* writeCache(text, digest)
              yield* invalidate
              yield* bus.publish(ModelsDev.Event.Refreshed, {})
            }),
          )
          .pipe(
            Effect.tapCause((cause) => Effect.logWarning("Failed to refresh the models catalog", { cause: cause })),
            Effect.ignore,
          )
      })

      if (fetch && !process.argv.includes("--get-yargs-completions")) {
        // Schedule.spaced runs the effect once, then waits between completions.
        yield* Effect.forkScoped(refresh().pipe(Effect.repeat(Schedule.spaced(ttl)), Effect.ignore))
      }

      return Service.of({ get, refresh })
    }),
  )

export function configured(options?: Options) {
  return makeGlobalNode({
    service: Service,
    layer: layer(options),
    deps: [FSUtil.node, Bus.node, App.node, KV.node, httpClient],
  })
}

export const node = configured()

export * as ModelsDev from "./models-dev.js"
