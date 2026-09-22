export * as ProviderRouter from "./router"

import { createHash } from "node:crypto"
import { Effect } from "effect"
import { Router } from "@reddb-io/redcode-schema/router"

/** How long one probe result is reused for the same address and key. */
export const TTL = 5 * 60_000
/** The whole probe, every step included, gives up after this and reports no router. */
export const TIMEOUT = 3_000

/** Request and response headers RedRouter documents; matched case-insensitively. */
export const Header = {
  decision: "x-red-router-decision",
  hint: "x-red-router-hint",
  tokenSaver: "x-red-router-token-saver",
  servedModel: "x-redrouter-served-model",
  cost: "x-redrouter-cost-usd",
  retryAt: "x-9router-retry-at",
  reason: "x-9router-reason",
} as const

/** The provider metadata key a step's RedRouter report (`reported`) is kept under. */
export const METADATA = "redrouter"

export type DetectInput = {
  readonly baseURL: string
  readonly apiKey?: string
  /** Probe again even when a cached result is still fresh, e.g. right after connecting. */
  readonly fresh?: boolean
  readonly fetch?: typeof fetch
  readonly timeout?: number
}

const cache = new Map<string, { value: Router.Detection; expires: number }>()
const pending = new Map<string, Promise<Router.Detection>>()
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * Detects what serves an OpenAI-compatible base URL (one ending in /v1): RedRouter's capabilities
 * document first, then its System One catalog, then the public version fingerprint of the 9Router
 * family. Results are cached per address and key. It never fails: an unreachable, slow or
 * unrecognised endpoint is `none`, so callers simply use no router features.
 */
export const detect = (input: DetectInput) => Effect.promise(() => lookup(input))

/** The freshest cached detection for an address, whatever key it was probed with. Never probes. */
export function known(baseURL: string) {
  const base = normalizeURL(baseURL)
  if (!base) return
  const now = Date.now()
  return [...cache.entries()]
    .filter(([key, entry]) => key.startsWith(`${base}\n`) && entry.expires > now)
    .map(([, entry]) => entry.value)
    .toSorted((a, b) => b.checkedAt - a.checkedAt)[0]
}

/** Drops cached detections, for one address or all of them. */
export function forget(baseURL?: string) {
  const base = baseURL === undefined ? undefined : normalizeURL(baseURL)
  for (const key of cache.keys()) if (base === undefined || key.startsWith(`${base}\n`)) cache.delete(key)
}

/**
 * A base URL in the form used to compare addresses: no trailing slash, and every loopback name
 * (`localhost`, `127.0.0.1`, `[::1]`) written as 127.0.0.1, since a router bound to one answers
 * on the others. Undefined for anything that is not a plain HTTP(S) URL.
 */
export function normalizeURL(baseURL: string) {
  const url = URL.parse(baseURL.trim())
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    return
  if (LOOPBACK.has(url.hostname)) url.hostname = "127.0.0.1"
  return url.href.replace(/\/+$/, "")
}

export function sameEndpoint(a: string | undefined, b: string | undefined) {
  if (a === undefined || b === undefined) return false
  const left = normalizeURL(a)
  return left !== undefined && left === normalizeURL(b)
}

export const isRedRouter = (detection: Router.Detection | undefined) => detection?.kind === "red-router"

/**
 * Cooperation headers for one request to a detected RedRouter. `decision: false` turns the
 * router's own decision layer off (Redcode's System One already chose tools for this turn);
 * `tokenSaver: false` keeps the prompt intact (compaction and validation must see all of it).
 * Anything the router did not advertise is left out.
 */
export function requestHeaders(
  detection: Router.Detection | undefined,
  input: { readonly decision?: boolean; readonly tokenSaver?: boolean },
): Record<string, string> {
  if (!isRedRouter(detection)) return {}
  const features = new Set(detection?.features)
  return {
    ...(input.decision === false && features.has("decision") ? { [Header.decision]: "off" } : {}),
    ...(input.tokenSaver === false && features.has("token-saver") ? { [Header.tokenSaver]: "off" } : {}),
  }
}

/**
 * What RedRouter reported about a finished response: the model that served it and its cost in
 * USD. The cost header is set on non-streaming responses; streams carry `usage.cost` in their
 * final usage instead, which is trusted only next to RedRouter's served-model header so another
 * provider's `usage.cost` (in its own units) is never read as dollars.
 */
export function reported(headers: Readonly<Record<string, string>> | undefined, usage?: unknown) {
  const servedModel = header(headers, Header.servedModel)
  const cost =
    dollars(header(headers, Header.cost)) ?? (servedModel && isRecord(usage) ? dollars(usage.cost) : undefined)
  if (servedModel === undefined && cost === undefined) return
  return { ...(servedModel ? { servedModel } : {}), ...(cost !== undefined ? { costUSD: cost } : {}) }
}

/** A header value by case-insensitive name; blank is absent. */
export function header(headers: Readonly<Record<string, string>> | undefined, name: string) {
  const lower = name.toLowerCase()
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === lower)?.[1]?.trim() || undefined
}

/** The USD cost a step's provider metadata carries from `reported`, when RedRouter priced it. */
export function reportedCost(metadata: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined) {
  return dollars(metadata?.[METADATA]?.costUSD)
}

function dollars(value: unknown) {
  const number = typeof value === "string" && value.trim() ? Number(value) : value
  return typeof number === "number" && Number.isFinite(number) && number >= 0 ? number : undefined
}

async function lookup(input: DetectInput) {
  const base = normalizeURL(input.baseURL)
  if (!base) return none(Date.now())
  // Keyed by a digest of the key, never the key itself: System One availability is per key.
  const key = `${base}\n${createHash("sha256").update(input.apiKey?.trim() ?? "").digest("hex").slice(0, 16)}`
  const hit = cache.get(key)
  if (!input.fresh && hit && hit.expires > Date.now()) return hit.value
  const running = pending.get(key)
  if (running) return running
  const next = probe(input)
    .catch(() => none(Date.now()))
    .then((value) => {
      cache.set(key, { value, expires: Date.now() + TTL })
      return value
    })
    .finally(() => pending.delete(key))
  pending.set(key, next)
  return next
}

async function probe(input: DetectInput): Promise<Router.Detection> {
  const fetcher = input.fetch ?? fetch
  const signal = AbortSignal.timeout(input.timeout ?? TIMEOUT)
  const base = input.baseURL.trim().replace(/\/+$/, "")
  const key = input.apiKey?.trim()
  // Redirects are refused so the key never follows a hop to another address.
  const get = (url: string, credentials: boolean) =>
    fetcher(url, {
      redirect: "error",
      signal,
      headers: { accept: "application/json", ...(credentials && key ? { authorization: `Bearer ${key}` } : {}) },
    })
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : undefined))
      .catch(() => undefined)
  const now = Date.now()
  const capabilities = await get(`${base}/capabilities`, true)
  if (isRecord(capabilities) && capabilities.product === "red-router") return fromCapabilities(capabilities, now)
  // Builds without /capabilities still serve the System One catalog. A server that answers any
  // path with its model list must not pass for one, so only a list of Jev models counts.
  const systemOne = await get(`${base}/models/systemone`, true)
  const models = isRecord(systemOne) && Array.isArray(systemOne.data) ? modelIDs(systemOne.data) : []
  if (models.length && models.every((id) => /\bjev\b/i.test(id)))
    return { kind: "red-router", features: ["systemone"], systemOne: { available: true, models }, checkedAt: now }
  const origin = URL.parse(base)?.origin
  const version = origin ? await get(`${origin}/api/version`, false) : undefined
  if (isRecord(version) && typeof version.currentVersion === "string")
    return { kind: "9router", version: version.currentVersion, features: [], checkedAt: now }
  return none(now)
}

function fromCapabilities(document: Record<string, unknown>, now: number): Router.Detection {
  const systemOne = record(document.systemone)
  const decision = record(document.decision)
  const session = record(document.session)
  const models = Array.isArray(systemOne.models)
    ? systemOne.models.filter((item): item is string => typeof item === "string" && item.length > 0)
    : []
  const available = systemOne.available === true && models.length > 0
  const flags: Array<[Router.Feature, boolean]> = [
    ["capabilities", true],
    ["systemone", available],
    ["combos", Array.isArray(record(document.combos).strategies)],
    ["decision", typeof decision.header === "string"],
    ["hint", decision.accepts_hint === true],
    ["token-saver", typeof document.token_saver_header === "string"],
    ["session-affinity", session.per_session_stickiness === true || Array.isArray(session.affinity_headers)],
    ["served-model", typeof document.served_model_header === "string"],
    ["cost", typeof document.cost_header === "string"],
    ["stream-usage-cost", document.stream_usage_cost === true],
  ]
  return {
    kind: "red-router",
    ...(typeof document.version === "string" ? { version: document.version } : {}),
    ...(typeof document.instance_id === "string" ? { instanceID: document.instance_id } : {}),
    features: flags.filter(([, on]) => on).map(([feature]) => feature),
    systemOne: { available, models },
    checkedAt: now,
  }
}

function modelIDs(data: ReadonlyArray<unknown>) {
  return data.flatMap((item) => {
    const id = record(item).id
    return typeof id === "string" && id.length > 0 ? [id] : []
  })
}

function none(now: number): Router.Detection {
  return { kind: "none", features: [], checkedAt: now }
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
