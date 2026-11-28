import { Cause, Context, Duration, Effect, Layer, Option, Schedule, Schema, Semaphore } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ModelsDev } from "@opencode/schema/models-dev"
import { App } from "./app.js"
import { Hash } from "@opencode/util/hash"
import { FSUtil } from "@opencode/util/fs-util"
import { Bus } from "./bus.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { Model } from "./model.js"
import { Provider } from "./provider.js"
import { KV } from "./kv.js"
import { ModelsDevCatalog } from "./models-dev/catalog.js"
import snapshotText from "./models-dev/snapshot.txt" with { type: "text" }

export const CatalogModelStatus = Schema.Literals(["alpha", "beta", "deprecated"])
export type CatalogModelStatus = typeof CatalogModelStatus.Type

export type Snapshot = {
  readonly info: Provider.Info
  readonly models: readonly Model.Info[]
  readonly environment: readonly string[]
}

export function normalize(input: typeof ModelsDevCatalog.Document.Type, digest: string): readonly Snapshot[] {
  return Object.values(input).flatMap((provider) => ModelsDevCatalog.normalize(provider, digest))
}

export { Event } from "@opencode/schema/models-dev"

export interface Interface {
  readonly get: () => Effect.Effect<readonly Snapshot[]>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
  readonly status: () => Effect.Effect<ModelsDev.CatalogStatus>
  readonly refreshCatalog: () => Effect.Effect<ModelsDev.CatalogRefresh>
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

const CatalogJson = Schema.fromJsonString(ModelsDevCatalog.Document)
const decodeCatalog = (text: string) => Schema.decodeUnknownEffect(CatalogJson)(text)
const Cache = Schema.Struct({
  updatedAt: Schema.Number,
  // Digest of the raw body, persisted so refresh() can skip republishing a
  // byte-identical catalog. Optional for entries written before it existed.
  digest: Schema.optional(Schema.String),
  body: Schema.String,
})
const CACHE_KEY = "models-dev:catalog"
const STATE_KEY = "models-dev:sources"
/** Public catalogs, tried after `REDCODE_MODELS_URL` and the `models.sources` configuration. */
export const DEFAULT_SOURCES = [
  "https://models.dev/experimental/v2.0/api.json?type=all",
  "https://raw.githubusercontent.com/reddb-io/redcode/refs/heads/models-catalog-cache/models.json",
  "https://github.com/reddb-io/redcode/releases/download/models-catalog/models.json",
] as const

/** Catalog URLs in the order they are tried: a URL without a `.json` path gets `/api.json`, duplicates go. */
export function sources(configured: readonly (string | undefined)[]) {
  const urls = [...configured, ...DEFAULT_SOURCES].flatMap((value) => {
    const url = value?.trim() ? URL.parse(value.trim()) : null
    if (!url) return []
    if (url.hostname === "models.dev" && url.pathname === "/") {
      url.pathname = "/experimental/v2.0/api.json"
      if (!url.searchParams.has("type")) url.searchParams.set("type", "all")
    }
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
    digest: Schema.optional(Schema.String),
    sources: Schema.Record(Schema.String, SourceState),
  }),
)
export type SourcesState = {
  source?: string
  fetchedAt?: number
  digest?: string
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
    ...(decoded.value.digest === undefined ? {} : { digest: decoded.value.digest }),
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
  | { readonly ok: true; readonly text: string; readonly catalog: typeof ModelsDevCatalog.Document.Type }
  | { readonly ok: false; readonly blocked: boolean; readonly reason: string }

// Bundled full provider catalog from models.dev, committed with its SHA-256 at
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
          bundledCache = normalize(catalog, bodyDigest(snapshotText))
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
      const file = options?.file || undefined
      const refreshEnabled = fetch || file !== undefined
      const userAgent = App.useragent(app)
      const ttl = Duration.minutes(5)
      const lock = Semaphore.makeUnsafe(1)
      type Active = {
        catalog: readonly Snapshot[]
        status: ModelsDev.CatalogStatus
        digest?: string
      }
      let active: Active | undefined

      const loadFromCache = Effect.fnUntraced(function* () {
        const value = yield* kv.get(CACHE_KEY)
        const cached = Schema.decodeUnknownOption(Cache)(value)
        const catalog = Option.isSome(cached)
          ? Schema.decodeUnknownOption(CatalogJson)(cached.value.body)
          : Option.none()
        if (Option.isSome(cached) && Option.isSome(catalog))
          return {
            catalog: catalog.value,
            updatedAt: cached.value.updatedAt,
            bodyDigest: bodyDigest(cached.value.body),
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
                        Effect.map(
                          (catalog): Outcome =>
                            Object.keys(catalog).length > 0
                              ? { ok: true, text, catalog }
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
            const digest = bodyDigest(outcome.text)
            const fetchedAt = Date.now()
            yield* writeState({
              source: url,
              fetchedAt,
              digest,
              sources: Object.fromEntries(Object.entries(state.sources).filter(([key]) => key !== url)),
            })
            return { ...outcome, url, digest, fetchedAt }
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

      const loadFromFile = file
        ? fs.readFileString(file).pipe(
            Effect.flatMap((text) =>
              decodeCatalog(text).pipe(
                Effect.map((catalog) =>
                  Object.keys(catalog).length
                    ? {
                        catalog,
                        digest: bodyDigest(text),
                        status: { source: "file", updatedAt: Date.now(), refreshEnabled } satisfies ModelsDev.CatalogStatus,
                      }
                    : undefined,
                ),
              ),
            ),
          )
        : Effect.undefined

      // The bundled snapshot is the boot-time floor for the catalog; the
      // periodic fetch below still refreshes on top.
      const loadSnapshot = options?.snapshot === false ? Effect.undefined : bundledSnapshot

      // Best-effort: a cache-write failure must never kill catalog
      // population. The payload has outgrown some KV backends' per-value
      // limits (Durable Object SQLite caps values at 2 MB and api.json
      // passed it in Aug 2026); a boot without a cache hit just refetches.
      const writeCache = Effect.fn("ModelsDev.writeCache")(function* (text: string, digest: string, updatedAt: number) {
        yield* kv.set(CACHE_KEY, { updatedAt, digest, body: text }).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            (cause) => Effect.logWarning("Failed to cache models.dev catalog", { cause }),
          ),
        )
      })

      const remoteStatus = (url: string, updatedAt: number): ModelsDev.CatalogStatus => ({
        source: "remote",
        // A configured mirror can carry credentials in its URL.
        origin: URL.parse(url)?.origin,
        updatedAt,
        refreshEnabled,
      })

      const populate = Effect.gen(function* () {
        const fromFile = yield* loadFromFile
        if (fromFile) return { ...fromFile, catalog: normalize(fromFile.catalog, fromFile.digest) }
        const cached = yield* loadFromCache()
        if (cached) {
          const state = yield* readState
          return {
            catalog: normalize(cached.catalog, cached.bodyDigest),
            digest: cached.bodyDigest,
            status:
              state.source && state.digest === cached.bodyDigest
                ? remoteStatus(state.source, state.fetchedAt ?? cached.updatedAt)
                : { source: "cache" as const, updatedAt: cached.updatedAt, refreshEnabled },
          }
        }
        const bundled = yield* loadSnapshot
        if (bundled) return { catalog: bundled, status: { source: "bundled" as const, refreshEnabled } }
        if (fetch && !file) {
          const result = yield* fetchChain(false)
          if (result) {
            yield* writeCache(result.text, result.digest, result.fetchedAt)
            return {
              catalog: normalize(result.catalog, result.digest),
              digest: result.digest,
              status: remoteStatus(result.url, result.fetchedAt),
            }
          }
        }
        return { catalog: [], status: { source: "empty" as const, refreshEnabled } }
      }).pipe(
        Effect.tap((loaded) => Effect.sync(() => (active = loaded))),
        Effect.withSpan("ModelsDev.populate"),
        Effect.orDie,
      )

      const [initial, releaseInitial] = yield* Effect.cachedInvalidateWithTTL(populate, Duration.infinity)
      const current = Effect.suspend(() => (active ? Effect.succeed(active) : initial))
      const status = () => current.pipe(Effect.map((loaded) => loaded.status))
      const get = () => current.pipe(Effect.map((loaded) => loaded.catalog))
      const update = Effect.fn("ModelsDev.update")(function* (force: boolean) {
        const before = yield* current
        return yield* lock.withPermit(
          Effect.gen(function* (): Effect.fn.Return<ModelsDev.CatalogRefresh> {
            const previous = active ?? before
            const checked = previous.status.updatedAt
            if (previous !== before || (!force && checked !== undefined && Date.now() - checked < Duration.toMillis(ttl)))
              return { outcome: "unchanged", catalog: previous.status }
            const next = yield* (file ? loadFromFile.pipe(Effect.orElseSucceed(() => undefined)) : fetchChain(force))
            if (!next) return { outcome: "unavailable", catalog: previous.status }
            const catalog = "url" in next ? remoteStatus(next.url, next.fetchedAt) : next.status
            if (next.digest === previous.digest) {
              active = { ...previous, status: catalog }
              return { outcome: "unchanged", catalog }
            }
            if ("url" in next) yield* writeCache(next.text, next.digest, next.fetchedAt)
            active = { catalog: normalize(next.catalog, next.digest), digest: next.digest, status: catalog }
            yield* releaseInitial
            yield* bus.publish(ModelsDev.Event.Refreshed, {}, { global: true })
            return { outcome: "updated", catalog }
          }),
        )
      })
      const refresh = (force = false) =>
        update(force).pipe(
          Effect.tapCause((cause) => Effect.logWarning("Failed to refresh the models catalog", { cause })),
          Effect.ignore,
        )
      const refreshCatalog = () =>
        refreshEnabled
          ? update(true)
          : status().pipe(Effect.map((catalog): ModelsDev.CatalogRefresh => ({ outcome: "disabled", catalog })))

      if (fetch && !file && !process.argv.includes("--get-yargs-completions")) {
        // Schedule.spaced runs the effect once, then waits between completions.
        yield* Effect.forkScoped(refresh().pipe(Effect.repeat(Schedule.spaced(ttl)), Effect.ignore))
      }

      return Service.of({ get, refresh, status, refreshCatalog })
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
