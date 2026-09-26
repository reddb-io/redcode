export * as RouterMCP from "./router-mcp"

import { createHash } from "node:crypto"
import { Effect, Option, Schema } from "effect"
import { ProviderRouter } from "./router"

/**
 * A client for RedRouter's MCP server (`POST {base URL}/mcp`, Streamable HTTP answered with one JSON
 * body, stateless). Its tools are read-only views of what the key can call and has spent; nothing
 * here changes routing, and the key-management tools are never called. Result shapes are versioned
 * apart from the app: a router is used only when it says, in the `x-redrouter-mcp-version` response
 * header or in initialize's `_meta`, that it speaks at least `SCHEMA_VERSION`. Anything else (no key,
 * no endpoint, a refused key, an older schema, a slow or broken answer) reads as no MCP, and every
 * call then returns undefined: callers simply offer nothing.
 */

/** The oldest result schema this client reads. */
export const SCHEMA_VERSION = 2
/** The schema that added `get_quotas`. */
export const QUOTAS_VERSION = 3
/**
 * The schema whose `usable` is true only while an account is free for that exact model, and whose
 * `status.state` names quota exhaustion (`quota_exhausted`, with `until`).
 */
export const USABLE_VERSION = 4
/** Request and response header carrying the result schema version. */
export const VERSION_HEADER = "x-redrouter-mcp-version"
/** The initialize `_meta` key carrying the result schema version. */
export const VERSION_META = "io.reddb/red-router-mcp-version"
export const PROTOCOL_VERSION = "2025-06-18"
/** How long a probe (available or not) is reused for the same address and key. */
export const TTL = 5 * 60_000
/** One request gives up after this. */
export const TIMEOUT = 3_000

export type Input = {
  readonly baseURL: string
  readonly apiKey?: string
  readonly fetch?: typeof fetch
  readonly timeout?: number
}

const Price = Schema.Struct({
  input: Schema.optional(Schema.NullOr(Schema.Finite)),
  output: Schema.optional(Schema.NullOr(Schema.Finite)),
})

/** One way a flat model is served; `pin_id` requests this offer only. */
export const Offer = Schema.Struct({
  id: Schema.String,
  pin_id: Schema.optional(Schema.NullOr(Schema.String)),
  provider: Schema.optional(Schema.NullOr(Schema.String)),
  available: Schema.Boolean,
})
export type Offer = typeof Offer.Type

export const Status = Schema.Struct({
  state: Schema.String,
  until: Schema.optional(Schema.String),
  error_rate: Schema.optional(Schema.Finite),
})
export type Status = typeof Status.Type

/** What the router says about a model, combo or flat model the key can call. */
export const Summary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: Schema.String,
  provider: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.optional(Schema.String) }))),
  context_length: Schema.NullOr(Schema.Finite),
  capabilities: Schema.Array(Schema.String),
  price_per_million: Schema.optional(Schema.NullOr(Price)),
  status: Status,
  usable: Schema.Boolean,
  free: Schema.optional(Schema.Boolean),
  offers: Schema.optional(Schema.Array(Offer)),
})
export type Summary = typeof Summary.Type

export const Reason = Schema.Struct({ code: Schema.String, detail: Schema.String })
export type Reason = typeof Reason.Type

/** How a suggestion compares to the model it would replace. */
export const Delta = Schema.Struct({
  price_delta_pct: Schema.NullOr(Schema.Finite),
  context_delta: Schema.NullOr(Schema.Finite),
  gained_capabilities: Schema.Array(Schema.String),
  lost_capabilities: Schema.Array(Schema.String),
})
export type Delta = typeof Delta.Type

export const Recommendation = Schema.Struct({
  ...Summary.fields,
  why: Schema.Array(Reason),
  why_text: Schema.String,
  delta: Schema.optional(Delta),
})
export type Recommendation = typeof Recommendation.Type

/** `recommend_models` arguments, as RedRouter's tool declares them. */
export type RecommendArgs = {
  readonly needs?: ReadonlyArray<string>
  readonly current?: string
  readonly equivalent_to?: string
  readonly min_context?: number
  readonly needs_input_tokens?: number
  readonly max_price_per_million?: number
  readonly free_only?: boolean
  readonly prefer?: "cheapest" | "largest_context"
  readonly include_combos?: boolean
  readonly limit?: number
}

export type Recommended = {
  readonly current?: Summary
  readonly recommendations: ReadonlyArray<Recommendation>
}

export const Usage = Schema.Struct({
  currency: Schema.String,
  totals: Schema.Struct({ requests: Schema.Finite, errors: Schema.Finite, cost: Schema.Finite }),
  this_month: Schema.optional(Schema.Struct({ cost: Schema.Finite })),
})
export type Usage = typeof Usage.Type

/** One quota window of one account, as the router last read it. `remaining_pct` is 0 to 100. */
export const Quota = Schema.Struct({
  name: Schema.String,
  remaining_pct: Schema.optional(Schema.NullOr(Schema.Finite)),
  unlimited: Schema.optional(Schema.Boolean),
  reset_at: Schema.optional(Schema.NullOr(Schema.String)),
})
export type Quota = typeof Quota.Type

export const Quotas = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      provider: Schema.String,
      accounts: Schema.Array(
        Schema.Struct({
          quotas: Schema.Array(Quota),
          error: Schema.optional(Schema.NullOr(Schema.String)),
        }),
      ),
    }),
  ),
})
export type Quotas = typeof Quotas.Type

/**
 * The MCP result schema the router at this address speaks, or undefined when it has none this
 * client reads (below `SCHEMA_VERSION`, no endpoint, no key). A router that refuses the key is
 * logged once per address and key. Never fails.
 */
export const version = (input: Input) =>
  Effect.gen(function* () {
    const session = yield* Effect.promise(() => probe(input))
    const key = keyOf(input)
    if (session || !key || !denied.has(key) || logged.has(key)) return session?.version
    logged.add(key)
    yield* Effect.logWarning("RedRouter refused the API key for its MCP server; model suggestions are off", {
      baseURL: input.baseURL,
    })
    return undefined
  })

/**
 * Whether the router can serve a model, combo or flat model now. From `USABLE_VERSION` on, `usable`
 * already counts only free accounts; an older router may call a model usable while it is rate
 * limited, failing, disabled or out of quota, so its state is checked too.
 */
export function usable(summary: Summary, version: number) {
  if (summary.usable !== true) return false
  return !(version >= USABLE_VERSION ? UNSERVABLE : UNSERVABLE_BEFORE_USABLE).has(summary.status.state)
}

const UNSERVABLE = new Set(["quota_exhausted", "unavailable", "disabled"])
const UNSERVABLE_BEFORE_USABLE = new Set([...UNSERVABLE, "rate_limited", "error"])

/** Whether the router at this address serves MCP results of at least `SCHEMA_VERSION`. Never fails. */
export const available = (input: Input) => version(input).pipe(Effect.map((value) => value !== undefined))

/**
 * Ranked suggestions for `args`, or undefined when the router has no usable MCP or the call failed.
 * A recommendation the router sent malformed is dropped alone.
 */
export const recommend = (input: Input, args: RecommendArgs) =>
  Effect.promise(async (): Promise<Recommended | undefined> => {
    const result = record(await call(input, "recommend_models", args))
    if (!Array.isArray(result.recommendations)) return
    const current = Option.getOrUndefined(decodeSummary(result.current))
    return {
      ...(current ? { current } : {}),
      recommendations: result.recommendations.flatMap((item) => Option.toArray(decodeRecommendation(item))),
    }
  })

/** One model, combo or flat model by id, or undefined (unknown id, no MCP, failure). */
export const model = (input: Input, id: string) =>
  Effect.promise(async () => Option.getOrUndefined(decodeSummary(record(await call(input, "get_model", { id })).model)))

/** The key's own spend over the last `hours`, or undefined. */
export const usage = (input: Input, hours?: number) =>
  Effect.promise(async () =>
    Option.getOrUndefined(decodeUsage(await call(input, "get_usage", hours === undefined ? {} : { hours }))),
  )

/**
 * The quota windows the router last read for the accounts of `provider` (a router provider id) the
 * key can route to, without asking the providers again. Undefined below `QUOTAS_VERSION`.
 */
export const quotas = (input: Input, provider?: string) =>
  Effect.promise(async () => {
    if (((await probe(input))?.version ?? 0) < QUOTAS_VERSION) return
    return Option.getOrUndefined(
      decodeQuotas(await call(input, "get_quotas", provider === undefined ? {} : { provider })),
    )
  })

/**
 * What a RedRouter API key is, from `GET {base URL}/key`: its role and where its MCP server is, or
 * undefined when the router does not say (an older router, a refused key, no key). The MCP URL is
 * kept only on the router's own origin, so the key is never sent anywhere else. Never fails.
 */
export const key = (input: Input) =>
  Effect.promise(async () => {
    const apiKey = input.apiKey?.trim()
    const base = input.baseURL.trim().replace(/\/+$/, "")
    if (!apiKey || !ProviderRouter.normalizeURL(base)) return
    const response = await (input.fetch ?? fetch)(`${base}/key`, {
      redirect: "error",
      signal: AbortSignal.timeout(input.timeout ?? TIMEOUT),
      headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
    }).catch(() => undefined)
    if (!response?.ok) return
    const body = record(await response.json().catch(() => undefined))
    const mcp = record(body.mcp)
    const role = keyRole(body.role)
    if (!role) return
    const url = mcpURL(base, mcp.url)
    return {
      role,
      ...(url ? { mcp: url } : {}),
      ...(typeof mcp.schema_version === "number" ? { version: mcp.schema_version } : {}),
    }
  })

/** A key role as RedRouter writes it, or undefined for anything else. */
export function keyRole(value: unknown): "standard" | "admin" | undefined {
  if (value === "admin") return "admin"
  if (value === "standard") return "standard"
  return undefined
}

/**
 * The MCP server URL a router gave (a path like `/v1/mcp`, or a full URL), resolved against its base
 * URL. Undefined when it points at another origin: the key must never follow it there.
 */
export function mcpURL(baseURL: string, value: unknown) {
  if (typeof value !== "string" || !value.trim()) return
  const base = URL.parse(baseURL)
  const url = base ? URL.parse(value.trim(), base) : undefined
  if (!base || !url || url.origin !== base.origin || url.username || url.password) return
  return url.href
}

/** Drops cached probes, for one address or all of them. */
export function forget(baseURL?: string) {
  const base = baseURL === undefined ? undefined : ProviderRouter.normalizeURL(baseURL)
  for (const store of [sessions, denied, logged])
    for (const key of store.keys()) if (base === undefined || key.startsWith(`${base}\n`)) store.delete(key)
}

const decodeSummary = Schema.decodeUnknownOption(Summary)
const decodeRecommendation = Schema.decodeUnknownOption(Recommendation)
const decodeUsage = Schema.decodeUnknownOption(Usage)
const decodeQuotas = Schema.decodeUnknownOption(Quotas)

type Session = { readonly protocolVersion: string; readonly version: number }

const sessions = new Map<string, { value: Session | undefined; expires: number }>()
const pending = new Map<string, Promise<Session | undefined>>()
/** Addresses and keys the router answered 401, and those already logged. */
const denied = new Set<string>()
const logged = new Set<string>()
let next = 0

/** A tool's `structuredContent`, or undefined for a failed call, an `isError` result or no MCP. */
async function call(input: Input, name: string, args: Record<string, unknown>) {
  const session = await probe(input)
  if (!session) return
  const response = await rpc(input, "tools/call", { name, arguments: args }, session.protocolVersion)
  const result = record(response?.body?.result)
  if (result.isError === true) return
  return result.structuredContent
}

async function probe(input: Input) {
  const key = keyOf(input)
  if (!key) return
  const hit = sessions.get(key)
  if (hit && hit.expires > Date.now()) return hit.value
  const running = pending.get(key)
  if (running) return running
  const probing = initialize(input)
    .catch(() => undefined)
    .then((value) => {
      sessions.set(key, { value, expires: Date.now() + TTL })
      return value
    })
    .finally(() => pending.delete(key))
  pending.set(key, probing)
  return probing
}

async function initialize(input: Input): Promise<Session | undefined> {
  const response = await rpc(input, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "redcode", version: "1" },
    _meta: { [VERSION_META]: SCHEMA_VERSION },
  })
  if (response?.status === 401) denied.add(keyOf(input) ?? "")
  if (!response?.body) return
  const result = record(response.body.result)
  const version = Number(response.version ?? record(result._meta)[VERSION_META])
  if (!Number.isFinite(version) || version < SCHEMA_VERSION) return
  return {
    protocolVersion: typeof result.protocolVersion === "string" ? result.protocolVersion : PROTOCOL_VERSION,
    version,
  }
}

async function rpc(input: Input, method: string, params: Record<string, unknown>, protocolVersion?: string) {
  // The MCP server always wants the key, whatever the router asks of /v1.
  const apiKey = input.apiKey?.trim()
  if (!apiKey) return
  // Redirects are refused so the key never follows a hop to another address.
  const response = await (input.fetch ?? fetch)(`${input.baseURL.trim().replace(/\/+$/, "")}/mcp`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(input.timeout ?? TIMEOUT),
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${apiKey}`,
      [VERSION_HEADER]: String(SCHEMA_VERSION),
      ...(protocolVersion ? { "mcp-protocol-version": protocolVersion } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++next, method, params }),
  }).catch(() => undefined)
  if (!response) return
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
    return { status: response.status, body: undefined, version: undefined }
  const body = record(await response.json().catch(() => undefined))
  if (body.error !== undefined) return { status: response.status, body: undefined, version: undefined }
  return { status: response.status, body, version: response.headers.get(VERSION_HEADER) ?? undefined }
}

// Keyed by a digest of the key, never the key itself: what a router serves is per key.
function keyOf(input: Input) {
  const base = ProviderRouter.normalizeURL(input.baseURL)
  const apiKey = input.apiKey?.trim()
  if (!base || !apiKey) return
  return `${base}\n${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
