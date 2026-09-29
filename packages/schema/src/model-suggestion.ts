export * as ModelSuggestion from "./model-suggestion.js"

import { Option, Schema } from "effect"
import { Model } from "./model.js"
import { optional } from "./schema.js"

/**
 * Why a session was offered another model of its RedRouter connection: images the model cannot see
 * (`vision`), a context close to its limit (`context`), a much cheaper equivalent (`cheaper`), or an
 * agent asking the router for alternatives without naming a need (`requested`). A session is never
 * offered a suggestion again for a trigger the person kept the model for.
 */
export const Trigger = Schema.Literals(["vision", "context", "cheaper", "requested"]).annotate({
  identifier: "ModelSuggestion.Trigger",
})
export type Trigger = typeof Trigger.Type

/** How the suggested model compares to the current one, as the router computed it. */
export const Delta = Schema.Struct({
  pricePct: Schema.NullOr(Schema.Finite).annotate({ description: "Price change in percent; negative is cheaper." }),
  context: Schema.NullOr(Schema.Finite).annotate({ description: "Context tokens gained (negative: lost)." }),
  gained: Schema.mutable(Schema.Array(Schema.String)),
  lost: Schema.mutable(Schema.Array(Schema.String)),
}).annotate({ identifier: "ModelSuggestion.Delta" })
export type Delta = typeof Delta.Type

/**
 * A model the session could switch to: a model of the same router connection that the router called
 * usable when it was suggested. Nothing switches until the person accepts it.
 */
export const Info = Schema.Struct({
  trigger: Trigger,
  current: Model.Ref,
  model: Model.Ref,
  name: Schema.String,
  kind: Schema.String.annotate({ description: "model, combo or flat, as the router lists it." }),
  why: Schema.mutable(Schema.Array(Schema.Struct({ code: Schema.String, detail: Schema.String }))),
  whyText: Schema.String,
  delta: Delta.pipe(optional),
  until: Schema.Finite.pipe(optional).annotate({
    description: "When the current model's exhausted quota resets, in epoch milliseconds.",
  }),
}).annotate({ identifier: "ModelSuggestion" })
export type Info = typeof Info.Type

export const Choice = Schema.Literals(["switch", "keep"])
export type Choice = typeof Choice.Type

/** The session metadata key holding the pending suggestion and the triggers the person kept the model for. */
export const METADATA_KEY = "modelSuggestion"

export const State = Schema.Struct({
  pending: Info.pipe(optional),
  kept: Schema.mutable(Schema.Array(Trigger)).pipe(optional),
}).annotate({ identifier: "ModelSuggestion.State" })
export type State = typeof State.Type
export type Stored = typeof State.Encoded

const decodeState = Schema.decodeUnknownOption(State)
const encodeState = Schema.encodeSync(State)

/** The suggestion state recorded on a session's metadata; empty when there is none or it is malformed. */
export function read(metadata: Readonly<Record<string, unknown>> | undefined): State {
  return Option.getOrElse(decodeState(metadata?.[METADATA_KEY]), () => ({}))
}

/**
 * The session metadata with `suggestion` pending, or undefined when nothing changes: the person
 * kept the model for its trigger, or the same suggestion is already pending.
 */
export function offer<V>(metadata: Readonly<Record<string, V>> | undefined, suggestion: Info) {
  const state = read(metadata)
  if (state.kept?.includes(suggestion.trigger)) return undefined
  const pending = state.pending
  if (
    pending?.trigger === suggestion.trigger &&
    pending.current.providerID === suggestion.current.providerID &&
    pending.current.id === suggestion.current.id &&
    pending.model.providerID === suggestion.model.providerID &&
    pending.model.id === suggestion.model.id
  )
    return undefined
  return write(metadata, { ...state, pending: suggestion })
}

/**
 * Answers the pending suggestion: either answer drops it, and `keep` also stops its trigger for the
 * rest of the session. Returns the answered suggestion, whose `model` a client selects on `switch`,
 * and the metadata to record; undefined when nothing is pending.
 */
export function answer<V>(metadata: Readonly<Record<string, V>> | undefined, choice: Choice) {
  const state = read(metadata)
  const suggestion = state.pending
  if (!suggestion) return undefined
  const kept = choice === "keep" ? Array.from(new Set([...(state.kept ?? []), suggestion.trigger])) : state.kept
  return { suggestion, metadata: write(metadata, { kept }) }
}

function write<V>(metadata: Readonly<Record<string, V>> | undefined, state: State): Record<string, V | Stored> {
  return { ...metadata, [METADATA_KEY]: encodeState(state) }
}

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
  if (suggestion.until === undefined || suggestion.until <= now) return undefined
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
