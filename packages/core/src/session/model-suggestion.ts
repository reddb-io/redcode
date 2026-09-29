export * as SessionModelSuggestion from "./model-suggestion.js"

import { ModelSuggestion } from "@opencode/schema/model-suggestion"
import { Option, Schema } from "effect"
import type { Model } from "../model.js"

/**
 * Turns a RedRouter `recommend_models` tool result into a model suggestion for the session. The
 * router's MCP server is registered under its connection's provider, so its tool is advertised as
 * `<server>_recommend_models`; only models of the session's own connection are ever suggested. A
 * suggestion is only recorded: the person switches (or keeps the model) from the card a client
 * shows, and nothing here changes the session's model.
 */

/** The router MCP tool whose results carry suggestions. */
export const TOOL = "recommend_models"
/** A cheaper equivalent is suggested only when it costs at least this much less, in percent. */
export const CHEAPER_PCT = -40
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
 * connection does not list. While the current model is out of quota, never one of its provider
 * either. A cheaper equivalent loses no capability at all and costs at least `CHEAPER_PCT` less.
 */
export function choose(
  result: Recommended,
  input: {
    readonly trigger: ModelSuggestion.Trigger
    readonly needs: ReadonlyArray<string>
    readonly current: Model.Ref
    readonly models: ReadonlyArray<Listed>
  },
): ModelSuggestion.Info | undefined {
  const exhausted = result.current?.status.state === "quota_exhausted"
  const spent = exhausted ? result.current?.provider?.id : undefined
  const until = exhausted ? Date.parse(result.current?.status.until ?? "") : Number.NaN
  return result.recommendations.flatMap((recommendation): ModelSuggestion.Info[] => {
    if (!usable(recommendation)) return []
    if (recommendation.id === input.current.id) return []
    if (spent && recommendation.provider?.id === spent) return []
    const lost = recommendation.delta?.lost_capabilities ?? []
    if (lost.some((capability) => input.needs.includes(capability))) return []
    if (input.needs.some((capability) => !recommendation.capabilities.includes(capability))) return []
    if (input.trigger === "cheaper" && (lost.length > 0 || (recommendation.delta?.price_delta_pct ?? 0) > CHEAPER_PCT))
      return []
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
