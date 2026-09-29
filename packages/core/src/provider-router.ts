export * as ProviderRouter from "./provider-router.js"

import { Option, Schema } from "effect"
import type { Router } from "@opencode/schema/router"

/**
 * RedRouter's request and response contract, spoken only over its public HTTP API: the cooperation
 * headers a request carries, what a response reports about how it was served, the key a connection
 * uses, and the key-management MCP tools that must never run without the person's confirmation.
 */

/** Request and response headers RedRouter documents; header lookups are case-insensitive. */
export const Header = {
  decision: "x-red-router-decision",
  hint: "x-red-router-hint",
  reasoning: "x-red-router-reasoning",
  reasoningReport: "x-redrouter-reasoning",
  tokenSaver: "x-red-router-token-saver",
  servedModel: "x-redrouter-served-model",
  cost: "x-redrouter-cost-usd",
  catalogVersion: "x-redrouter-catalog-version",
  keyRole: "x-redrouter-key-role",
  mcp: "x-redrouter-mcp",
} as const

/** The message metadata key a step's RedRouter report is kept under. */
export const METADATA = "redrouter"

/** The variant that leaves a request's reasoning effort to RedRouter's reasoning autopilot. */
export const AUTO = "auto"

/** Effort levels, least thought first. RedRouter's reasoning autopilot moves on the same ladder. */
export const LADDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const

/** The effort levels among a model's variants, least thought first. */
export function ladder(levels: Iterable<string>) {
  const names = new Set(levels)
  return LADDER.filter((level) => names.has(level))
}

/**
 * Whether a model gets the `auto` variant: the router's autopilot accepts `auto` and the model has
 * two effort levels at least, so there is something to choose between.
 */
export function supportsAuto(levels: Iterable<string>, features: ReadonlySet<Router.Feature>) {
  return features.has("reasoning-auto") && ladder(levels).length >= 2
}

/** The longest hint RedRouter reads; a longer header is ignored whole. */
export const HINT_LIMIT = 512

/** Hint keys only a router that lists them in `decision.hint_keys` reads; an older one rejects them. */
export const SIGNAL_KEYS = ["effort", "stall", "feedback", "frustration"]

/**
 * What System One made of a Session's latest turn, for the router: `hint` is an
 * `x-red-router-hint` value and `decision: false` turns the router's own decision layer off because
 * System One already chose tools for the turn. Set by whoever classifies the turn; absent otherwise.
 */
export interface Guidance {
  readonly hint?: string
  readonly decision?: boolean
}

// Process-local, like the Session drain: the latest guidance and response report per Session.
const guidances = new Map<string, Guidance>()
const reports = new Map<string, Report>()
const LIMIT = 1000

/** Records (or with undefined, forgets) the guidance later requests of a Session carry. */
export function guide(sessionID: string, guidance: Guidance | undefined) {
  guidances.delete(sessionID)
  if (guidance) remember(guidances, sessionID, guidance)
}

export const guidance = (sessionID: string) => guidances.get(sessionID)

/**
 * Whether the selected model is a RedRouter combo that picks its member per request, which is what
 * a hint steers. The router chooses the model then.
 */
export const routesByHint = (strategy: string | undefined) => strategy === "auto" || strategy === "smart"

export interface RequestInput {
  readonly features: ReadonlySet<Router.Feature>
  /** The variant the Session selected; `auto` leaves the effort to the router. */
  readonly variant?: string
  /** The strategy of the combo the model is, when it is one. */
  readonly strategy?: string
  /** False keeps the prompt intact: compaction and validation must see all of it. */
  readonly tokenSaver?: boolean
  readonly guidance?: Guidance
}

/**
 * Cooperation headers for one request to a detected RedRouter. A person's own variant is never
 * overridden (`off`); `auto` asks the router's autopilot to decide and lets it read the hint. The
 * hint goes to a combo that picks its member per request, or to the autopilot. Anything the router
 * did not advertise, and any hint outside its grammar, is left out.
 */
export function requestHeaders(input: RequestInput): Record<string, string> {
  const features = input.features
  // An older router whose configured autopilot already covers the key decides without being asked.
  const autopilot =
    input.variant === AUTO &&
    features.has("reasoning") &&
    (features.has("reasoning-auto") || features.has("reasoning-applies"))
  const reasoning = !features.has("reasoning")
    ? undefined
    : autopilot
      ? features.has("reasoning-auto")
        ? AUTO
        : undefined
      : "off"
  const hinted = routesByHint(input.strategy) || autopilot
  const hint = features.has("hint-signals") ? input.guidance?.hint : withoutSignals(input.guidance?.hint)
  return {
    ...(input.guidance?.decision === false && features.has("decision") ? { [Header.decision]: "off" } : {}),
    ...(input.tokenSaver === false && features.has("token-saver") ? { [Header.tokenSaver]: "off" } : {}),
    ...(hint && hinted && features.has("hint") && validHint(hint) ? { [Header.hint]: hint } : {}),
    ...(reasoning ? { [Header.reasoning]: reasoning } : {}),
  }
}

function withoutSignals(hint: string | undefined) {
  if (!hint) return hint
  return (
    hint
      .split(";")
      .filter((pair) => !SIGNAL_KEYS.includes(pair.split("=")[0] ?? ""))
      .join(";") || undefined
  )
}

/**
 * Whether a value follows RedRouter's `x-red-router-hint` grammar: `;`-separated `key=value` pairs,
 * at most 512 characters, each key once. Keys are `complexity` (a unit or a tier), `deliberation` (a
 * unit), `needs_tool` (`true` or `false`), `tier`, and the reasoning signals `effort` (a ladder
 * level), `stall` (`true` or `false`), `feedback` (`agrees`, `corrects`, `rejects` or `neutral`) and
 * `frustration` (a unit). The router ignores the whole header when any pair is malformed or out of
 * range, so an invalid hint is never sent.
 */
export function validHint(value: string) {
  if (!value || value.length > HINT_LIMIT) return false
  const pairs = value.split(";").map((pair) => pair.split("="))
  const keys = pairs.map((pair) => pair[0])
  return (
    new Set(keys).size === keys.length &&
    pairs.every((pair) => pair.length === 2 && validHintPair(pair[0] ?? "", pair[1] ?? ""))
  )
}

/** A unit in the hint's decimal form: 0 to 1 with at most six fraction digits. */
export function hintUnit(value: number) {
  return String(Math.round(Math.min(1, Math.max(0, value)) * 1_000_000) / 1_000_000)
}

const TIERS = new Set(["simple", "medium", "complex", "reasoning"])
const EFFORTS = new Set<string>(LADDER)
const FEEDBACK = new Set(["agrees", "corrects", "rejects", "neutral"])

function validHintPair(key: string, value: string) {
  const unit = /^[01](\.\d{1,6})?$/.test(value) && Number(value) <= 1
  if (key === "complexity") return unit || TIERS.has(value)
  if (key === "deliberation" || key === "frustration") return unit
  if (key === "needs_tool" || key === "stall") return value === "true" || value === "false"
  if (key === "tier") return TIERS.has(value)
  if (key === "effort") return EFFORTS.has(value)
  if (key === "feedback") return FEEDBACK.has(value)
  return false
}

/** The reasoning level RedRouter applied (or, in shadow, would have), the client's level it replaced, and why. */
export interface ReasoningReport {
  readonly level: string
  readonly from?: string
  readonly cause?: string
  readonly shadow?: boolean
}

/**
 * What RedRouter reported about a response: the model that served it, its cost in USD, the version
 * of the model catalog the key sees and the reasoning level it applied.
 */
export interface Report {
  readonly servedModel?: string
  readonly costUSD?: number
  readonly catalogVersion?: string
  readonly reasoning?: ReasoningReport
}

/**
 * The report a response's headers carry, or undefined when they carry none. The cost header is set
 * on non-streaming responses; a stream carries `usage.cost` in its final usage instead (see
 * `usageCost`), which is trusted only next to the served-model header so another provider's
 * `usage.cost` (in its own units) is never read as dollars.
 */
export function reported(headers: Headers): Report | undefined {
  const read = (name: string) => headers.get(name)?.trim() || undefined
  const servedModel = read(Header.servedModel)
  const costUSD = dollars(read(Header.cost))
  const catalogVersion = read(Header.catalogVersion)
  const reasoning = reasoningReport(read(Header.reasoningReport))
  if (servedModel === undefined && costUSD === undefined && catalogVersion === undefined && reasoning === undefined)
    return
  return {
    ...(servedModel ? { servedModel } : {}),
    ...(costUSD === undefined ? {} : { costUSD }),
    ...(catalogVersion ? { catalogVersion } : {}),
    ...(reasoning ? { reasoning } : {}),
  }
}

/** `X-RedRouter-Reasoning: <from|->-><level>; cause=<cause>[; shadow]`. */
export function reasoningReport(value: string | undefined): ReasoningReport | undefined {
  if (!value) return
  const [move = "", ...rest] = value.split(";").map((part) => part.trim())
  const arrow = move.lastIndexOf("->")
  const level = arrow === -1 ? "" : move.slice(arrow + 2).trim()
  if (!level) return
  const from = move.slice(0, arrow).trim()
  const cause = rest.find((part) => part.startsWith("cause="))?.slice("cause=".length)
  return {
    level,
    ...(from && from !== "-" ? { from } : {}),
    ...(cause ? { cause } : {}),
    ...(rest.includes("shadow") ? { shadow: true } : {}),
  }
}

/** Merges what a response of a Session's current step reported. */
export function observe(sessionID: string, report: Report) {
  const previous = reports.get(sessionID)
  reports.delete(sessionID)
  remember(reports, sessionID, { ...previous, ...report })
}

/** Takes (and forgets) what the responses of a Session's current step reported. */
export function take(sessionID: string) {
  const report = reports.get(sessionID)
  reports.delete(sessionID)
  return report
}

const decodeUsage = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      usage: Schema.optional(Schema.NullOr(Schema.Struct({ cost: Schema.optional(Schema.Unknown) }))),
    }),
  ),
)

/**
 * Passes a server-sent event stream through unchanged while reading the `usage.cost` its chunks
 * report, calling `found` with each cost in dollars.
 */
export function usageCost(found: (costUSD: number) => void) {
  const decoder = new TextDecoder()
  const state = { pending: "" }
  const scan = (line: string) => {
    const data = line.trim()
    if (!data.startsWith("data:") || !data.includes('"cost"')) return
    const cost = dollars(Option.getOrUndefined(decodeUsage(data.slice("data:".length).trim()))?.usage?.cost)
    if (cost !== undefined) found(cost)
  }
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      const lines = (state.pending + decoder.decode(chunk, { stream: true })).split("\n")
      state.pending = lines.pop() ?? ""
      lines.forEach(scan)
    },
    flush() {
      scan(state.pending + decoder.decode())
    },
  })
}

/** A key role as RedRouter writes it, or undefined for anything else. */
export function keyRole(value: unknown): Router.KeyRole | undefined {
  if (value === "admin" || value === "standard") return value
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

/** The name RedRouter's MCP server gives itself, and the name Redcode registers it under. */
export const MCP_SERVER = "red-router"

/**
 * Why an MCP call must be confirmed by the person every time, whatever the permission rules,
 * earlier approvals, `--yolo` or a client's auto-approve say, or undefined when it need not be.
 * RedRouter's admin keys can create API keys, list every key and read another key's usage through
 * its MCP server; an agent must never do that on its own. Tools that read only the calling key stay
 * ordinary. `server` is the name the MCP server gave itself, or the name it was registered under.
 */
export function protectedCall(input: { readonly server: string; readonly tool: string; readonly args: unknown }) {
  if (input.server !== MCP_SERVER) return
  if (input.tool === "create_api_key") return "Creates a RedRouter API key"
  if (input.tool === "list_api_keys") return "Lists every RedRouter API key this key can manage"
  if (input.tool !== "get_usage") return
  const args = input.args
  if (typeof args === "object" && args !== null && "api_key_id" in args && args.api_key_id !== undefined)
    return "Reads another RedRouter API key's usage"
  return undefined
}

function dollars(value: unknown) {
  const number = typeof value === "string" && value.trim() ? Number(value) : value
  return typeof number === "number" && Number.isFinite(number) && number >= 0 ? number : undefined
}

function remember<T>(store: Map<string, T>, key: string, value: T) {
  store.set(key, value)
  if (store.size > LIMIT) store.delete(store.keys().next().value ?? key)
}
