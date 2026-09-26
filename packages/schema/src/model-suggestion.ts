export * as ModelSuggestion from "./model-suggestion"

import { Schema } from "effect"
import { Event } from "./event"
import { optional } from "./schema"
import { SessionID } from "./session-id"

/**
 * Why a session was offered another model: images the model cannot see (`vision`), tools it cannot
 * call (`tools`), a context close to its limit (`context`), repeated provider failures or a router
 * reporting it rate limited, out of quota or unhealthy (`provider_errors`), or a much cheaper equivalent
 * (`cheaper`). A session is offered at most one suggestion per trigger until its situation changes.
 */
export const Trigger = Schema.Literals(["vision", "tools", "context", "provider_errors", "cheaper"]).annotate({
  identifier: "ModelSuggestion.Trigger",
})
export type Trigger = typeof Trigger.Type

export const Ref = Schema.Struct({ providerID: Schema.String, modelID: Schema.String }).annotate({
  identifier: "ModelSuggestion.Ref",
})
export type Ref = typeof Ref.Type

/** How the suggested model compares to the current one, as the router computed it. */
export const Delta = Schema.Struct({
  pricePct: Schema.NullOr(Schema.Finite).annotate({ description: "Price change in percent; negative is cheaper." }),
  context: Schema.NullOr(Schema.Finite).annotate({ description: "Context tokens gained (negative: lost)." }),
  gained: Schema.Array(Schema.String),
  lost: Schema.Array(Schema.String),
}).annotate({ identifier: "ModelSuggestion.Delta" })
export type Delta = typeof Delta.Type

/**
 * A model the session could switch to. `model` is what a client selects when the person accepts:
 * a model of the same router connection, a flat model's pinned offer when one offer is suggested.
 * It is one the router called usable when it was suggested. Nothing switches until the person says
 * so, and not when the router says it has become unusable since.
 */
export const Info = Schema.Struct({
  trigger: Trigger,
  current: Ref,
  model: Ref,
  name: Schema.String,
  kind: Schema.String.annotate({ description: "model, combo or flat, as the router lists it." }),
  why: Schema.Array(Schema.Struct({ code: Schema.String, detail: Schema.String })),
  whyText: Schema.String,
  delta: optional(Delta),
  until: optional(
    Schema.Finite.annotate({ description: "When the current model's exhausted quota resets, in epoch milliseconds." }),
  ),
}).annotate({ identifier: "ModelSuggestion" })
export type Info = typeof Info.Type

export const Choice = Schema.Literals(["switch", "keep"])
export type Choice = typeof Choice.Type

export const Suggested = Event.define({
  type: "session.model.suggested",
  schema: {
    sessionID: SessionID,
    suggestion: Info,
  },
})

/** The person answered a suggestion: every client showing it drops it. */
export const Resolved = Event.define({
  type: "session.model.suggestion.resolved",
  schema: {
    sessionID: SessionID,
    trigger: Trigger,
    choice: Choice,
  },
})

export const Definitions = Event.inventory(Suggested, Resolved)

/**
 * The deltas of a suggestion in compact words, for the card: `price -45%`, `context +72K`,
 * `+vision`, `-pdf`. Unknown or zero changes are left out.
 */
export function deltaParts(delta: Delta | undefined) {
  if (!delta) return []
  return [
    ...(delta.pricePct ? [`price ${signed(delta.pricePct)}%`] : []),
    ...(delta.context ? [`context ${signed(compact(delta.context))}`] : []),
    ...delta.gained.map((capability) => `+${capability}`),
    ...delta.lost.map((capability) => `-${capability}`),
  ]
}

/**
 * `quota until <local time>` while the current model's quota is exhausted, for the card; undefined
 * when no reset is known or it has passed.
 */
export function quotaText(suggestion: Info, now = Date.now()) {
  if (suggestion.until === undefined || suggestion.until <= now) return
  return `quota until ${clock(suggestion.until, now)}`
}

/** A reset instant in local time: the time alone today, with the date on another day. */
export function clock(at: number, now = Date.now()) {
  const date = new Date(at)
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  if (date.toDateString() === new Date(now).toDateString()) return time
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`
}

function signed(value: number | string) {
  const text = String(value)
  return text.startsWith("-") ? text : `+${text}`
}

function compact(tokens: number) {
  const size = Math.abs(tokens)
  const sign = tokens < 0 ? "-" : ""
  if (size >= 1_000_000) return `${sign}${round(size / 1_000_000)}M`
  if (size >= 1_000) return `${sign}${round(size / 1_000)}K`
  return `${sign}${size}`
}

function round(value: number) {
  return Math.round(value * 10) / 10
}
