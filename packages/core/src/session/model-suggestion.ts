export * as SessionModelSuggestion from "./model-suggestion.js"

import type { Message } from "@opencode/ai"
import { ModelSuggestion } from "@opencode/schema/model-suggestion"
import type { SessionError } from "@opencode/schema/session-error"
import type { TokenUsage } from "@opencode/schema/token-usage"
import { Effect, Option, Schema } from "effect"
import { Mcp } from "../mcp/index.js"
import type { Model } from "../model.js"
import { ProviderRouter } from "../provider-router.js"

/**
 * Turns a RedRouter `recommend_models` result into a model suggestion for the session. The router is
 * asked either by the agent (its MCP server is registered under its connection's provider, so the
 * tool is advertised as `<server>_recommend_models`) or by Redcode itself when a trigger fires:
 * images the model cannot see, tools it cannot call, a context close to its limit, a provider that
 * keeps failing or is out of quota, or a much cheaper equivalent in the catalog. Only models of the
 * session's own connection are ever suggested. A suggestion is only recorded: the person switches
 * (or keeps the model) from the card a client shows, and nothing here changes the session's model.
 */

/** The router MCP tool whose results carry suggestions. */
export const TOOL = "recommend_models"
/** A cheaper equivalent is suggested only when it costs at least this much less, in percent. */
export const CHEAPER_PCT = -40
/** Share of the usable context in use at which a larger context is suggested. */
export const CONTEXT_SHARE = 0.85
/** Provider failures in a row after which an equivalent is suggested. */
export const REPEATED_FAILURES = 2
/** How many recommendations the router is asked for. */
export const RECOMMENDATIONS = 5
/** How long Redcode waits for the router's answer before offering nothing. */
export const TIMEOUT = "10 seconds"
/** Sessions whose asked triggers and failures are remembered at once; the oldest is forgotten first. */
export const TRACKED = 1000
/**
 * Router states that make a model unservable now. Tool results do not say which MCP schema the
 * router speaks, so the states of routers older than schema 4, whose `usable` ignored rate limits
 * and errors, are excluded too.
 */
const UNSERVABLE = new Set(["quota_exhausted", "unavailable", "disabled", "rate_limited", "error"])

const Offer = Schema.Struct({
  id: Schema.String,
  pin_id: Schema.optional(Schema.NullOr(Schema.String)),
  available: Schema.Boolean,
})

/** What the router says about a model, combo or flat model the key can call. */
const Summary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: Schema.String,
  provider: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.optional(Schema.String) }))),
  capabilities: Schema.Array(Schema.String),
  status: Schema.Struct({ state: Schema.String, until: Schema.optional(Schema.String) }),
  usable: Schema.Boolean,
  offers: Schema.optional(Schema.Array(Offer)),
})
export type Summary = typeof Summary.Type

const Recommendation = Schema.Struct({
  ...Summary.fields,
  why: Schema.Array(Schema.Struct({ code: Schema.String, detail: Schema.String })),
  why_text: Schema.String,
  delta: Schema.optional(
    Schema.Struct({
      price_delta_pct: Schema.NullOr(Schema.Finite),
      context_delta: Schema.NullOr(Schema.Finite),
      gained_capabilities: Schema.Array(Schema.String),
      lost_capabilities: Schema.Array(Schema.String),
    }),
  ),
})
export type Recommendation = typeof Recommendation.Type

export type Recommended = {
  readonly current?: Summary
  readonly recommendations: ReadonlyArray<Recommendation>
}

/** The `recommend_models` arguments that decide the trigger and the capabilities a suggestion keeps. */
const Args = Schema.Struct({
  needs: Schema.optional(Schema.Array(Schema.String)),
  equivalent_to: Schema.optional(Schema.String),
  min_context: Schema.optional(Schema.Finite),
  needs_input_tokens: Schema.optional(Schema.Finite),
  max_price_per_million: Schema.optional(Schema.Finite),
  free_only: Schema.optional(Schema.Boolean),
  prefer: Schema.optional(Schema.String),
})
export type Args = typeof Args.Type

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const decodeEnvelope = Schema.decodeUnknownOption(
  Schema.Struct({ current: Schema.optional(Schema.Unknown), recommendations: Schema.Array(Schema.Unknown) }),
)
const decodeSummary = Schema.decodeUnknownOption(Summary)
const decodeRecommendation = Schema.decodeUnknownOption(Recommendation)
const decodeArgs = Schema.decodeUnknownOption(Args)

type Listed = Pick<Model.Info, "id" | "modelID" | "providerID" | "aliases" | "capabilities">

/**
 * The suggestion a `recommend_models` call offers the session, or undefined when its result is not
 * the router's, or no recommendation is worth a switch from `current` to one of `models` (the models
 * of the session's connection).
 */
export function suggest(input: {
  readonly args: unknown
  readonly output: unknown
  readonly current: Model.Ref
  readonly models: ReadonlyArray<Listed>
}): ModelSuggestion.Info | undefined {
  const result = parse(input.output)
  if (!result) return undefined
  const args = Option.getOrElse(decodeArgs(input.args), (): Args => ({}))
  const models = input.models.filter((model) => model.providerID === input.current.providerID)
  return choose(result, {
    trigger: triggerOf(
      args,
      models.find((model) => model.id === input.current.id),
    ),
    needs: args.needs ?? [],
    current: input.current,
    models,
  })
}

/**
 * The router's answer, from the tool's structured output or its JSON text. A recommendation the
 * router sent malformed is dropped alone; anything that is not an answer at all is undefined.
 */
export function parse(output: unknown): Recommended | undefined {
  const value = typeof output === "string" ? Option.getOrUndefined(decodeJson(output)) : output
  const envelope = Option.getOrUndefined(decodeEnvelope(value))
  if (!envelope) return undefined
  const current = Option.getOrUndefined(decodeSummary(envelope.current))
  return {
    ...(current ? { current } : {}),
    recommendations: envelope.recommendations.flatMap((item) => Option.toArray(decodeRecommendation(item))),
  }
}

/**
 * Why the agent asked the router: for vision the current model cannot see, for a larger context, for
 * a cheaper equivalent, or for alternatives without a named need.
 */
export function triggerOf(args: Args, current: Pick<Model.Info, "capabilities"> | undefined): ModelSuggestion.Trigger {
  if (args.needs?.includes("vision") && !current?.capabilities.input.includes("image")) return "vision"
  if (args.min_context !== undefined || args.needs_input_tokens !== undefined || args.prefer === "largest_context")
    return "context"
  if (
    args.equivalent_to !== undefined ||
    args.prefer === "cheapest" ||
    args.max_price_per_million !== undefined ||
    args.free_only === true
  )
    return "cheaper"
  return "requested"
}

/**
 * The first recommendation worth a switch, as a model of the connection. Never one the router cannot
 * serve now, the current model itself, one that loses or lacks a capability in `needs`, or one the
 * connection does not list. While the current model is out of quota (as the router says, or as
 * `exhausted` knows from the failure), never one of its provider either. An equivalent (for provider
 * errors or a cheaper one) loses no capability at all, and a cheaper one costs at least `CHEAPER_PCT`
 * less.
 */
export function choose(
  result: Recommended,
  input: {
    readonly trigger: ModelSuggestion.Trigger
    readonly needs: ReadonlyArray<string>
    readonly current: Model.Ref
    readonly models: ReadonlyArray<Listed>
    readonly exhausted?: boolean
  },
): ModelSuggestion.Info | undefined {
  const exhausted = input.exhausted === true || result.current?.status.state === "quota_exhausted"
  const spent = exhausted ? result.current?.provider?.id : undefined
  const until = exhausted ? Date.parse(result.current?.status.until ?? "") : Number.NaN
  return result.recommendations.flatMap((recommendation): ModelSuggestion.Info[] => {
    if (!usable(recommendation)) return []
    if (recommendation.id === input.current.id) return []
    if (spent && recommendation.provider?.id === spent) return []
    const lost = recommendation.delta?.lost_capabilities ?? []
    if (lost.some((capability) => input.needs.includes(capability))) return []
    if (input.needs.some((capability) => !recommendation.capabilities.includes(capability))) return []
    if ((input.trigger === "cheaper" || input.trigger === "provider_errors") && lost.length > 0) return []
    if (input.trigger === "cheaper" && (recommendation.delta?.price_delta_pct ?? 0) > CHEAPER_PCT) return []
    const target = targetOf(recommendation, input.models)
    if (!target || target.id === input.current.id) return []
    const delta = recommendation.delta
    return [
      {
        trigger: input.trigger,
        current: { providerID: input.current.providerID, id: input.current.id },
        model: { providerID: target.providerID, id: target.id },
        name: recommendation.name,
        kind: recommendation.kind,
        why: recommendation.why.map((reason) => ({ code: reason.code, detail: reason.detail })),
        whyText: recommendation.why_text,
        ...(delta
          ? {
              delta: {
                pricePct: delta.price_delta_pct,
                context: delta.context_delta,
                gained: [...delta.gained_capabilities],
                lost: [...delta.lost_capabilities],
              },
            }
          : {}),
        ...(Number.isFinite(until) ? { until } : {}),
      },
    ]
  })[0]
}

/** Whether the router can serve a model, combo or flat model now. */
export function usable(summary: Summary) {
  return summary.usable && !UNSERVABLE.has(summary.status.state)
}

/**
 * The connection's model a recommendation is selected as: the model listed under its id (or an
 * alias), otherwise the pin of the router's first available offer that the connection lists.
 */
function targetOf(recommendation: Recommendation, models: ReadonlyArray<Listed>) {
  const direct = models.find(
    (model) =>
      model.id === recommendation.id ||
      model.modelID === recommendation.id ||
      model.aliases?.includes(recommendation.id) === true,
  )
  if (direct) return direct
  return (recommendation.offers ?? [])
    .filter((offer) => offer.available && offer.pin_id)
    .flatMap((offer) => models.filter((model) => model.id === offer.pin_id))[0]
}

/** `recommend_models` arguments Redcode sends when a trigger fires, as RedRouter's tool declares them. */
export type RecommendArgs = {
  readonly needs: ReadonlyArray<string>
  readonly current: string
  readonly limit: number
  readonly equivalent_to?: string
  readonly min_context?: number
  readonly needs_input_tokens?: number
  readonly prefer?: "cheapest" | "largest_context"
}

type Reason = ModelSuggestion.Info["why"][number]

/** A trigger that fired: what to ask the router, and what a suggestion must keep. */
export type Request = {
  readonly trigger: ModelSuggestion.Trigger
  readonly args: RecommendArgs
  /** Capabilities the session relies on; a suggestion never lacks or loses one. */
  readonly needs: ReadonlyArray<string>
  /** Reasons Redcode already knows, shown before the router's own. */
  readonly reasons?: ReadonlyArray<Reason>
  /** Whether the current model is known to be out of quota, whatever the router says of it. */
  readonly exhausted?: boolean
}

/** How a provider failure bears on suggestions: see `failureOf`. */
export type Failure = "quota" | "unavailable" | "failure"

type Described = Pick<Model.Info, "id" | "modelID" | "pinOf" | "capabilities" | "limit">
type Priced = Pick<Model.Info, "id" | "providerID" | "enabled" | "capabilities" | "limit" | "cost">

/**
 * The capabilities the session relies on, from what this step sends: `vision` and `pdf` for images
 * and PDFs attached by the person or returned by tools, `tools` when the step offers any.
 */
export function needsOf(input: { readonly messages: ReadonlyArray<Message>; readonly tools: boolean }) {
  const mimes = input.messages.flatMap((message) =>
    message.content.flatMap((part) => {
      if (part.type === "media") return [part.media.mediaType]
      if (part.type === "tool-result" && part.result.type === "content")
        return part.result.value.flatMap((item) => (item.type === "file" ? [item.mime] : []))
      return []
    }),
  )
  return [
    ...(mimes.some((mime) => mime.startsWith("image/")) ? ["vision"] : []),
    ...(mimes.includes("application/pdf") ? ["pdf"] : []),
    ...(input.tools ? ["tools"] : []),
  ]
}

/**
 * The first trigger a step fires, in order of how badly the session needs another model: images the
 * model cannot see, tools it cannot call, a context of `tokens` at `CONTEXT_SHARE` of the usable
 * window or more.
 */
export function detect(input: {
  readonly model: Described
  readonly needs: ReadonlyArray<string>
  readonly tokens?: number
}): Request | undefined {
  const needs = input.needs
  const args = { needs: [...needs], current: routerID(input.model), limit: RECOMMENDATIONS }
  if (needs.includes("vision") && !input.model.capabilities.input.some((item) => item.startsWith("image")))
    return { trigger: "vision", args, needs }
  if (needs.includes("tools") && !input.model.capabilities.tools) return { trigger: "tools", args, needs }
  const usable = usableContext(input.model.limit)
  if (input.tokens === undefined || usable <= 0 || input.tokens < usable * CONTEXT_SHARE) return undefined
  return {
    trigger: "context",
    args: { ...args, needs_input_tokens: input.tokens, min_context: input.model.limit.context + 1 },
    needs,
  }
}

/** The equivalent a much cheaper model of the connection could be, when the catalog lists one. */
export function cheaper(input: {
  readonly model: Described & Priced
  readonly models: ReadonlyArray<Priced>
  readonly needs: ReadonlyArray<string>
}): Request | undefined {
  const price = priceOf(input.model)
  if (price === undefined || price <= 0) return undefined
  const ceiling = price * (1 + CHEAPER_PCT / 100)
  const found = input.models.some(
    (model) =>
      model.providerID === input.model.providerID &&
      model.id !== input.model.id &&
      model.enabled &&
      (model.capabilities.tools || !input.model.capabilities.tools) &&
      input.model.capabilities.input.every((modality) => model.capabilities.input.includes(modality)) &&
      model.limit.context >= input.model.limit.context &&
      (priceOf(model) ?? Infinity) <= ceiling,
  )
  if (!found) return undefined
  return { trigger: "cheaper", args: equivalent(input.model, input.needs), needs: input.needs }
}

/**
 * How a provider failure bears on suggestions, from its classified type and HTTP status: out of quota
 * (`quota`), a rate limit the runner will not wait out because it resets too far off
 * (`unavailable`), a failure that counts toward `REPEATED_FAILURES` (`failure`), or none (a refused
 * key, an invalid request, a content filter: another model would not help).
 */
export function failureOf(error: SessionError.Error, retrying: boolean): Failure | undefined {
  if (error.type === "provider.quota" || error.status === 402) return "quota"
  const limited = error.type === "provider.rate-limit" || error.status === 429
  if (limited && !retrying) return "unavailable"
  if (limited || FAILURES.has(error.type) || (error.status !== undefined && error.status >= 500)) return "failure"
  return undefined
}

/**
 * The equivalent to ask for after a provider failure: at once when the model is out of quota or
 * unavailable for a while, after `REPEATED_FAILURES` failures in a row otherwise.
 */
export function afterFailure(input: {
  readonly model: Described
  readonly failure: Failure
  readonly failures: number
}): Request | undefined {
  if (input.failure === "failure" && input.failures < REPEATED_FAILURES) return undefined
  return {
    trigger: "provider_errors",
    args: equivalent(input.model, []),
    needs: [],
    ...(input.failure === "quota" ? { reasons: [OUT_OF_QUOTA], exhausted: true } : {}),
    ...(input.failure === "unavailable" ? { reasons: [UNAVAILABLE], exhausted: true } : {}),
  }
}

/** Tokens the latest answer had in context, or undefined before the model answered. */
export function contextInUse(tokens: TokenUsage.Info | undefined) {
  if (!tokens) return undefined
  return tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
}

/** Tokens of context a model can take for input: its input limit, or its context less its output. */
export function usableContext(limit: Model.Info["limit"]) {
  return limit.input || Math.max(0, limit.context - limit.output)
}

/** The id the router knows a model by. A pinned offer is asked about as its flat model. */
export function routerID(model: Pick<Model.Info, "modelID" | "pinOf">) {
  return model.pinOf ?? model.modelID
}

/**
 * The suggestion a `recommend_models` answer to a fired trigger offers, as a model of the current
 * connection, with the reasons Redcode knew first; undefined when the answer is not the router's or
 * no recommendation is worth a switch.
 */
export function recommended(input: {
  readonly request: Request
  readonly output: unknown
  readonly current: Model.Ref
  readonly models: ReadonlyArray<Listed>
}): ModelSuggestion.Info | undefined {
  const result = parse(input.output)
  if (!result) return undefined
  const suggestion = choose(result, {
    trigger: input.request.trigger,
    needs: input.request.needs,
    current: input.current,
    models: input.models.filter((model) => model.providerID === input.current.providerID),
    exhausted: input.request.exhausted,
  })
  // The router may give the same reason itself.
  const reasons = (input.request.reasons ?? []).filter(
    (reason) => !suggestion?.why.some((item) => item.code === reason.code),
  )
  if (!suggestion || reasons.length === 0) return suggestion
  return {
    ...suggestion,
    why: [...reasons, ...suggestion.why],
    whyText: [...reasons.map((reason) => reason.detail), suggestion.whyText].filter(Boolean).join("; "),
  }
}

/**
 * Asks the router's MCP server for `request` and returns the suggestion it offers, or undefined when
 * the server is not registered, the call fails as a tool, or the router does not answer within
 * `TIMEOUT`. Calls through the session's own MCP client; a transport failure is left to the caller.
 */
export const ask = Effect.fn("SessionModelSuggestion.ask")(function* (input: {
  readonly request: Request
  readonly current: Model.Ref
  readonly models: ReadonlyArray<Listed>
}) {
  const mcp = yield* Mcp.Service
  if (!(yield* mcp.servers()).some((server) => server.name === ProviderRouter.MCP_SERVER)) return undefined
  const answered = yield* mcp
    .callTool({ server: ProviderRouter.MCP_SERVER, name: TOOL, args: input.request.args })
    .pipe(Effect.timeoutOption(TIMEOUT))
  if (Option.isNone(answered) || answered.value.isError) return undefined
  const result = answered.value
  return recommended({
    ...input,
    output: result.structured ?? result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
  })
})

/**
 * Per-session memory of what was asked, so a trigger is asked once per situation (its key: the model
 * in use, or the session itself for a cheaper equivalent), and of provider failures in a row.
 * Process-local and bounded like the drain: a session forgotten here may be asked again.
 */
export function tracker(limit = TRACKED) {
  const states = new Map<string, { readonly asked: Map<ModelSuggestion.Trigger, string>; failures: number }>()
  const stateOf = (sessionID: string) => {
    const state = states.get(sessionID) ?? { asked: new Map(), failures: 0 }
    states.delete(sessionID)
    states.set(sessionID, state)
    if (states.size > limit) states.delete(states.keys().next().value ?? sessionID)
    return state
  }
  return {
    /** Whether `trigger` is still open for `key`; claims it when it is. */
    claim: (sessionID: string, trigger: ModelSuggestion.Trigger, key: string) => {
      const state = stateOf(sessionID)
      if (state.asked.get(trigger) === key) return false
      state.asked.set(trigger, key)
      return true
    },
    /** Counts a provider failure; returns the failures in a row so far. */
    fail: (sessionID: string) => {
      const state = stateOf(sessionID)
      state.failures += 1
      return state.failures
    },
    /** A provider answered: failures no longer repeat. */
    recover: (sessionID: string) => {
      const state = states.get(sessionID)
      if (state) state.failures = 0
    },
  }
}

const FAILURES = new Set(["provider.rate-limit", "provider.internal", "provider.transport", "provider.timeout"])
const OUT_OF_QUOTA: Reason = { code: "quota_exhausted", detail: "the current model is out of quota" }
const UNAVAILABLE: Reason = { code: "unavailable", detail: "the current model is unavailable for a while" }

function equivalent(model: Described, needs: ReadonlyArray<string>): RecommendArgs {
  const id = routerID(model)
  return { needs: [...needs], current: id, equivalent_to: id, prefer: "cheapest", limit: RECOMMENDATIONS }
}

/** Input plus output price per million tokens at the base tier, or undefined when the catalog has none. */
function priceOf(model: Pick<Model.Info, "cost">) {
  const cost = model.cost.find((item) => item.tier === undefined) ?? model.cost[0]
  return cost ? cost.input + cost.output : undefined
}
