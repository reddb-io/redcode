import path from "path"
import { Cause, Context, Duration, Effect, Layer, Option, Ref, Schedule, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/unstable/http"
import { type ParseError, parse as parseJsonc } from "jsonc-parser"
import { ModelsDev } from "@reddb-io/redcode-schema/models-dev"
import { Global } from "./global"
import { Flag } from "./flag/flag"
import { Flock } from "./util/flock"
import { FSUtil } from "./fs-util"
import { InstallationChannel, InstallationVersion } from "./installation/version"
import { EventV2 } from "./event"
import { makeGlobalNode } from "./effect/app-node"
import { httpClient } from "./effect/app-node-platform"
import { ModelsSnapshot } from "./models-snapshot"

export const CatalogModelStatus = Schema.Literals(["alpha", "beta", "deprecated"])
export type CatalogModelStatus = typeof CatalogModelStatus.Type

const InterleavedField = Schema.Union([
  Schema.Literals(["reasoning", "reasoning_content", "reasoning_text"]),
  Schema.String,
])

const USER_AGENT = `redcode/${InstallationChannel}/${InstallationVersion}/${Flag.REDCODE_CLIENT}`

const CostTier = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache_read: Schema.optional(Schema.Finite),
  cache_write: Schema.optional(Schema.Finite),
  tier: Schema.Struct({
    type: Schema.Literal("context"),
    size: Schema.Finite,
  }),
})

const Cost = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache_read: Schema.optional(Schema.Finite),
  cache_write: Schema.optional(Schema.Finite),
  tiers: Schema.optional(Schema.Array(CostTier)),
  context_over_200k: Schema.optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache_read: Schema.optional(Schema.Finite),
      cache_write: Schema.optional(Schema.Finite),
    }),
  ),
})

const ReasoningOption = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("effort"),
    values: Schema.Array(Schema.NullOr(Schema.String)),
  }),
  Schema.Struct({
    type: Schema.Literal("toggle"),
  }),
  Schema.Struct({
    type: Schema.Literal("budget_tokens"),
    min: Schema.optional(Schema.Finite),
    max: Schema.optional(Schema.Finite),
  }),
])

export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  family: Schema.optional(Schema.String),
  release_date: Schema.String,
  attachment: Schema.Boolean,
  reasoning: Schema.Boolean,
  temperature: Schema.Boolean,
  tool_call: Schema.Boolean,
  reasoning_options: Schema.optional(Schema.Array(ReasoningOption)),
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Boolean,
      InterleavedField,
      Schema.Struct({
        field: InterleavedField,
      }),
    ]),
  ),
  cost: Schema.optional(Cost),
  limit: Schema.Struct({
    context: Schema.Finite,
    input: Schema.optional(Schema.Finite),
    output: Schema.Finite,
  }),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
      output: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      modes: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            cost: Schema.optional(Cost),
            provider: Schema.optional(
              Schema.Struct({
                body: Schema.optional(Schema.Record(Schema.String, Schema.MutableJson)),
                headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
              }),
            ),
          }),
        ),
      ),
    }),
  ),
  status: Schema.optional(CatalogModelStatus),
  provider: Schema.optional(
    Schema.Struct({ npm: Schema.optional(Schema.String), api: Schema.optional(Schema.String) }),
  ),
})
export type Model = Schema.Schema.Type<typeof Model>

export const Provider = Schema.Struct({
  api: Schema.optional(Schema.String),
  name: Schema.String,
  env: Schema.Array(Schema.String),
  id: Schema.String,
  npm: Schema.optional(Schema.String),
  models: Schema.Record(Schema.String, Model),
})

export type Provider = Schema.Schema.Type<typeof Provider>

export const Event = ModelsDev.Event

declare const REDCODE_MODELS_DEV: Record<string, Provider> | undefined

/** Where the catalog returned by `get()` came from. */
export type Origin = "cache" | "snapshot" | "file" | "empty"

export interface SourceStatus {
  readonly url: string
  /** Epoch milliseconds until which this source is skipped; absent when it is not blocked. */
  readonly blockedUntil?: number
  readonly reason?: string
}

export interface Status {
  readonly origin: Origin
  /** The source that last produced the disk cache. */
  readonly source?: string
  /** Epoch milliseconds of the last successful fetch (the cache file's mtime when unknown). */
  readonly fetchedAt?: number
  readonly sources: readonly SourceStatus[]
}

export interface Interface {
  readonly get: () => Effect.Effect<Record<string, Provider>>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
  readonly status: () => Effect.Effect<Status>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/ModelsDev") {}

/** Statuses that mean a network policy refuses the source, not a transient outage. */
const BLOCKED_STATUS = new Set([401, 403, 407, 451])
const BLOCKED_ERROR = /proxy|certificate|cert_|self[- ]signed|tls|ssl|unable to (get|verify)/i
/** Backoff after the first, second and later consecutive blocked attempts. */
const BACKOFF = [Duration.hours(1), Duration.hours(6), Duration.hours(24)]
const MAX_BACKOFF = Duration.toMillis(BACKOFF[BACKOFF.length - 1])

export function backoff(failures: number) {
  return Duration.toMillis(BACKOFF[Math.min(Math.max(failures, 1), BACKOFF.length) - 1])
}

/**
 * Classifies a request failure from the messages and codes of the error and its causes only, never
 * from stack frames (a path such as `.../tls-socket.js` in a stack must not look like a TLS block).
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
  const reason = parts[0]?.split("\n")[0]?.trim() || "request failed"
  return { blocked: parts.some((part) => BLOCKED_ERROR.test(part)), reason }
}

interface SourceState {
  failures: number
  blockedUntil?: number
  reason?: string
}

interface State {
  source?: string
  fetchedAt?: number
  /** Set once the per-URL `models-<hash>.json` caches of earlier versions have been removed. */
  legacyCacheRemoved?: boolean
  sources: Record<string, SourceState>
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

/**
 * Decodes the persisted state, dropping malformed source entries and capping `blockedUntil` at
 * now + 24h so a clock that was wrong when the state was written cannot block a source for longer.
 */
export function decodeState(value: unknown, now = Date.now()): State {
  const input =
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const sources: Record<string, SourceState> = {}
  const rawSources = input.sources
  if (typeof rawSources === "object" && rawSources !== null && !Array.isArray(rawSources)) {
    for (const [url, entry] of Object.entries(rawSources)) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue
      const record = entry as Record<string, unknown>
      if (!finite(record.failures) || record.failures < 0) continue
      if (record.blockedUntil !== undefined && !finite(record.blockedUntil)) continue
      if (record.reason !== undefined && typeof record.reason !== "string") continue
      sources[url] = {
        failures: Math.floor(record.failures),
        blockedUntil: record.blockedUntil === undefined ? undefined : Math.min(record.blockedUntil, now + MAX_BACKOFF),
        reason: record.reason,
      }
    }
  }
  return {
    source: typeof input.source === "string" ? input.source : undefined,
    fetchedAt: finite(input.fetchedAt) ? input.fetchedAt : undefined,
    legacyCacheRemoved: input.legacyCacheRemoved === true ? true : undefined,
    sources,
  }
}

/** Applies `{env:VAR}` substitution the way the config loader does. */
function substituteEnv(text: string) {
  return text.replace(/\{env:([^}]+)\}/g, (_, name: string) => process.env[name] || "")
}

type Outcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly blocked: boolean; readonly reason: string }

const TOO_LARGE = Symbol("models-catalog-too-large")

const CONFIG_NAMES = ["opencode.json", "opencode.jsonc", "redcode.json", "redcode.jsonc", "config.json", "config.jsonc"]

function configuredSources(text: string | undefined): string[] | undefined {
  if (!text) return undefined
  const errors: ParseError[] = []
  const value = parseJsonc(substituteEnv(text), errors, { allowTrailingComma: true }) as
    | { models?: { sources?: unknown } }
    | undefined
  if (errors.length) return undefined
  const sources = value?.models?.sources
  if (!Array.isArray(sources)) return undefined
  return sources.filter((item): item is string => typeof item === "string")
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const events = yield* EventV2.Service
    const http = (yield* HttpClient.HttpClient).pipe(
      HttpClient.retryTransient({
        retryOn: "errors-and-responses",
        times: 2,
        schedule: Schedule.exponential(200).pipe(Schedule.jittered),
      }),
    )

    const filepath = path.join(Global.Path.cache, "models.json")
    const statePath = path.join(Global.Path.cache, "models-state.json")
    const ttl = Duration.minutes(5)
    const lockKey = `models-dev:${filepath}`
    const origin = yield* Ref.make<Origin>("empty")

    // The catalog cache is shared by every project, so only global configuration may redirect it:
    // the user config directory, then REDCODE_CONFIG_DIR, REDCODE_CONFIG and REDCODE_CONFIG_CONTENT.
    const sources = yield* Effect.cached(
      Effect.gen(function* () {
        const read = (file: string) => fs.readFileStringSafe(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
        const files = [
          ...CONFIG_NAMES.map((name) => path.join(Global.Path.config, name)),
          ...(Flag.REDCODE_CONFIG_DIR ? CONFIG_NAMES.map((name) => path.join(Flag.REDCODE_CONFIG_DIR!, name)) : []),
          ...(Flag.REDCODE_CONFIG ? [Flag.REDCODE_CONFIG] : []),
        ]
        let configured: string[] | undefined
        for (const file of files) configured = configuredSources(yield* read(file)) ?? configured
        configured = configuredSources(Flag.REDCODE_CONFIG_CONTENT) ?? configured
        return ModelsSnapshot.sources([Flag.REDCODE_MODELS_URL, ...(configured ?? [])])
      }),
    )

    const fresh = Effect.fnUntraced(function* () {
      const stat = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!stat) return false
      const mtime = Option.getOrElse(stat.mtime, () => new Date(0)).getTime()
      return Date.now() - mtime < Duration.toMillis(ttl)
    })

    const readState = fs.readJson(statePath).pipe(
      Effect.map((value) => decodeState(value)),
      Effect.catch(() => Effect.succeed<State>({ sources: {} })),
    )

    // Earlier versions cached each REDCODE_MODELS_URL in its own `models-<sha1>.json`.
    const removeLegacyCaches = fs.readDirectoryEntries(Global.Path.cache).pipe(
      Effect.flatMap((entries) =>
        Effect.forEach(
          entries.filter((entry) => /^models-[0-9a-f]{40}\.json$/.test(entry.name)),
          (entry) => fs.remove(path.join(Global.Path.cache, entry.name), { force: true }).pipe(Effect.ignore),
          { discard: true },
        ),
      ),
      Effect.ignore,
    )

    // Reads at most MAX_BYTES of the body; undefined when the response is larger.
    const readCapped = (res: HttpClientResponse.HttpClientResponse) => {
      const length = Number(res.headers["content-length"])
      if (Number.isFinite(length) && length > ModelsSnapshot.MAX_BYTES) return Effect.succeed(undefined)
      return res.stream.pipe(
        Stream.runFoldEffect(
          () => ({ size: 0, chunks: [] as Uint8Array[] }),
          (acc, chunk) => {
            acc.size += chunk.byteLength
            if (acc.size > ModelsSnapshot.MAX_BYTES) return Effect.fail(TOO_LARGE)
            acc.chunks.push(chunk)
            return Effect.succeed(acc)
          },
        ),
        Effect.map((acc): string | undefined => Buffer.concat(acc.chunks).toString("utf8")),
        Effect.catch((error) => (error === TOO_LARGE ? Effect.succeed(undefined) : Effect.fail(error))),
      )
    }

    const writeAtomic = (target: string, text: string) => {
      const tempfile = `${target}.${process.pid}.${Date.now()}.tmp`
      return fs.writeWithDirs(tempfile, text).pipe(
        Effect.andThen(fs.rename(tempfile, target)),
        Effect.catch((error) =>
          fs.remove(tempfile, { force: true }).pipe(Effect.ignore, Effect.andThen(Effect.fail(error))),
        ),
      )
    }

    const attempt = (url: string): Effect.Effect<Outcome> =>
      HttpClientRequest.get(url).pipe(
        HttpClientRequest.setHeader("User-Agent", USER_AGENT),
        http.execute,
        Effect.flatMap((res): Effect.Effect<Outcome, unknown> => {
          if (res.status < 200 || res.status >= 300)
            return Effect.succeed({ ok: false, blocked: BLOCKED_STATUS.has(res.status), reason: `HTTP ${res.status}` })
          return readCapped(res).pipe(
            Effect.flatMap((text): Effect.Effect<Outcome> => {
              // Too large is a failed fetch, not a network policy.
              if (text === undefined)
                return Effect.succeed({
                  ok: false,
                  blocked: false,
                  reason: `response larger than ${ModelsSnapshot.MAX_BYTES} bytes`,
                })
              const sanitized = ModelsSnapshot.sanitizeCatalog(text)
              // A 200 that is not a JSON object of providers is a captive portal or a proxy block page.
              if (!sanitized)
                return Effect.succeed({ ok: false, blocked: true, reason: "response is not a models catalog" })
              const dropped = sanitized.droppedProviders + sanitized.droppedModels
              return (
                dropped > 0
                  ? Effect.logDebug("Dropped invalid models catalog entries", {
                      source: url,
                      providers: sanitized.droppedProviders,
                      models: sanitized.droppedModels,
                    })
                  : Effect.void
              ).pipe(Effect.as<Outcome>({ ok: true, text: ModelsSnapshot.catalogText(text, sanitized) }))
            }),
          )
        }),
        Effect.timeout("30 seconds"),
        Effect.catchCause((cause) => Effect.succeed<Outcome>({ ok: false, ...classifyError(Cause.squash(cause)) })),
      )

    // Tries every source that is not backing off (all of them when forced) and records the outcome.
    // Callers hold the Flock, so the state file has a single writer.
    const fetchChain = Effect.fn("ModelsDev.fetchChain")(function* (force: boolean) {
      const list = yield* sources
      const state = yield* readState
      const now = Date.now()
      if (!state.legacyCacheRemoved) {
        yield* removeLegacyCaches
        state.legacyCacheRemoved = true
      }
      let text: string | undefined
      for (const url of list) {
        const previous = state.sources[url]
        if (!force && previous?.blockedUntil !== undefined && previous.blockedUntil > now) continue
        const outcome = yield* attempt(url)
        if (outcome.ok) {
          if (previous?.blockedUntil !== undefined)
            yield* Effect.logInfo("Models catalog source reachable again", { source: url })
          delete state.sources[url]
          state.source = url
          state.fetchedAt = now
          text = outcome.text
          break
        }
        if (!outcome.blocked) {
          yield* Effect.logDebug("Models catalog source failed", { source: url, reason: outcome.reason })
          continue
        }
        const failures = (previous?.failures ?? 0) + 1
        const wait = backoff(failures)
        state.sources[url] = { failures, blockedUntil: now + wait, reason: outcome.reason }
        // Warn once when a source becomes blocked; later failures stay quiet until it recovers.
        if (previous?.blockedUntil === undefined) {
          yield* Effect.logWarning(
            `Models catalog source ${url} is blocked (${outcome.reason}); using the cached or bundled catalog and retrying in ${Math.round(wait / 3_600_000)}h. On a restricted network set REDCODE_MODELS_URL or "models": { "sources": [...] } in the global config to a reachable mirror.`,
          )
        } else {
          yield* Effect.logDebug("Models catalog source still blocked", { source: url, reason: outcome.reason })
        }
      }
      yield* writeAtomic(statePath, JSON.stringify(state)).pipe(Effect.ignore)
      return text
    })

    const loadFile = (file: string) =>
      fs.readFileStringSafe(file).pipe(
        Effect.map((text) => (text === undefined ? undefined : ModelsSnapshot.parseCatalog(text))),
        Effect.catch(() => Effect.succeed(undefined)),
        Effect.map((value) => value as Record<string, Provider> | undefined),
      )

    const populate = Effect.gen(function* () {
      if (Flag.REDCODE_MODELS_PATH !== undefined) {
        const fromFile = yield* loadFile(Flag.REDCODE_MODELS_PATH)
        if (fromFile) return yield* Ref.set(origin, "file").pipe(Effect.as(fromFile))
      } else {
        const fromDisk = yield* loadFile(filepath)
        if (fromDisk) return yield* Ref.set(origin, "cache").pipe(Effect.as(fromDisk))
        // Unreadable or not a catalog: drop it so the next refresh replaces it.
        yield* fs.remove(filepath, { force: true }).pipe(Effect.ignore)
      }
      const snapshot = typeof REDCODE_MODELS_DEV === "undefined" ? undefined : REDCODE_MODELS_DEV
      if (snapshot && Object.keys(snapshot).length > 0)
        return yield* Ref.set(origin, "snapshot").pipe(Effect.as(snapshot))
      if (Flag.REDCODE_DISABLE_MODELS_FETCH) return yield* Ref.set(origin, "empty").pipe(Effect.as({}))
      // Flock is cross-process: concurrent Redcode CLIs can race on this cache file.
      const text = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          const text = yield* fetchChain(false)
          if (text !== undefined) yield* writeAtomic(filepath, text).pipe(Effect.ignore)
          return text
        }),
      )
      if (text === undefined) return yield* Ref.set(origin, "empty").pipe(Effect.as({}))
      yield* Ref.set(origin, "cache")
      return JSON.parse(text) as Record<string, Provider>
    }).pipe(Effect.withSpan("ModelsDev.populate"), Effect.orDie)

    const [cachedGet, invalidate] = yield* Effect.cachedInvalidateWithTTL(populate, Duration.infinity)

    const get = (): Effect.Effect<Record<string, Provider>> => cachedGet

    const refresh = Effect.fn("ModelsDev.refresh")(function* (force = false) {
      if (!force && (yield* fresh())) return
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          // Re-check under the lock: another process may have refreshed between
          // our outer check and lock acquisition.
          if (!force && (yield* fresh())) return
          const text = yield* fetchChain(force)
          if (text === undefined) return
          const previous = yield* fs.readFileStringSafe(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
          // Rewrite even when unchanged so the mtime restarts the freshness window.
          yield* writeAtomic(filepath, text)
          if (previous === text) return
          yield* invalidate
          yield* events.publish(Event.Refreshed, {})
        }),
      ).pipe(
        Effect.tapCause((cause) => Effect.logWarning("Failed to refresh the models catalog", { cause })),
        Effect.ignore,
      )
    })

    const status = Effect.fn("ModelsDev.status")(function* () {
      yield* get()
      const state = yield* readState
      const stat = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      const mtime = stat ? Option.getOrUndefined(stat.mtime)?.getTime() : undefined
      const list = yield* sources
      return {
        origin: yield* Ref.get(origin),
        source: state.source,
        fetchedAt: state.fetchedAt ?? mtime,
        sources: list.map((url) => ({
          url,
          blockedUntil: state.sources[url]?.blockedUntil,
          reason: state.sources[url]?.reason,
        })),
      } satisfies Status
    })

    if (!Flag.REDCODE_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
      // Schedule.spaced runs the effect once, then waits between completions. Blocked sources are
      // skipped until their backoff expires, so this tick costs nothing on a restricted network.
      yield* Effect.forkScoped(refresh().pipe(Effect.repeat(Schedule.spaced("60 minutes")), Effect.ignore))
    }

    return Service.of({ get, refresh, status })
  }),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [FSUtil.node, EventV2.node, httpClient] })

export * as ModelsDev from "./models-dev"
