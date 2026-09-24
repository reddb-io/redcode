export * as ModelChoice from "./model-choice"

import fuzzysort from "fuzzysort"
import { Schema } from "effect"
import { ModelsDev } from "./models-dev"

/**
 * Choosing the model a subagent runs on, shared by both runtimes: the `models` tool's search and
 * paging, and the closest ids an unknown model fails with. Each runtime turns its own model records
 * into {@link Entry} values and decides which of them a subagent may run on with {@link runnable}.
 */

export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 100

export const Capability = Schema.Literals(["reasoning", "tool_call", "attachments"])
export type Capability = typeof Capability.Type

export const Parameters = Schema.Struct({
  query: Schema.optional(Schema.String).annotate({
    description: "Words to look for in model ids and names, e.g. opus or gpt 5. Every word must match.",
  }),
  provider: Schema.optional(Schema.String).annotate({
    description: "Only models of this provider, by id or name. Try your own provider first.",
  }),
  capabilities: Schema.optional(Schema.Array(Capability)).annotate({
    description: "Only models that have every one of these capabilities.",
  }),
  all: Schema.optional(Schema.Boolean).annotate({
    description: "Include older versions of each model family. By default only the newest of each family is listed.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: `Maximum models to return (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}).`,
  }),
  cursor: Schema.optional(Schema.String).annotate({
    description: "The cursor a previous page returned, to read the next page.",
  }),
})
export type Parameters = typeof Parameters.Type

export const DESCRIPTION = [
  "Search the models available to run a subagent on, across the connected providers.",
  "",
  'Use it only when the user asks for a particular model or reasoning level for a subagent: it turns the name they used into the exact "providerID/modelID" the task tool\'s model parameter takes, and lists the variants that model accepts. Never guess an id.',
  "",
  "Your own provider comes first, then the other providers, newest models first and one per model family unless all is true. Each entry gives the id, name, provider, context and output limits in tokens, variants, and the price per million tokens when it is known. System One evaluator models and deprecated models are never listed: a subagent cannot run on them.",
  "",
  "Results are paged: when more models match, the output ends with a cursor to pass for the next page.",
].join("\n")

/** One model as the search reads it, whatever runtime it came from. */
export interface Entry {
  readonly providerID: string
  readonly id: string
  readonly name: string
  /** The provider's display name. */
  readonly provider: string
  readonly family?: string
  /** The release date as `YYYY-MM-DD`; newest first sorts on it as text. */
  readonly released: string
  readonly reasoning: boolean
  readonly toolCall: boolean
  readonly attachments: boolean
  /** The reasoning variants a caller may pass, as `ReasoningAuto.options` lists them. */
  readonly variants: ReadonlyArray<string>
  readonly limit: { readonly context: number; readonly output: number }
  /** Dollars per million tokens; left out when the price is unknown, so none is shown rather than a free one. */
  readonly cost?: { readonly input: number; readonly output: number }
}

/** Whether a subagent can run on the model: never a System One evaluator, never a deprecated model. */
export function runnable(model: {
  readonly providerID: string
  readonly id: string
  readonly status?: string
  readonly protocol?: string
}) {
  return (
    model.status !== "deprecated" &&
    model.protocol !== "systemone" &&
    // A model the configuration redeclares loses the catalog's protocol, so the offer list decides too.
    !ModelsDev.systemOneOffer(model.providerID, model.id)
  )
}

/** The `providerID/modelID` references closest to what was asked for, best first. */
export function closest(refs: ReadonlyArray<string>, text: string, limit = 5) {
  const fuzzy = fuzzysort.go(text, refs, { limit }).map((match) => match.target)
  if (fuzzy.length) return fuzzy
  // A typo breaks fuzzy matching, which needs every character in order; shared words still point the way.
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1)
  return refs
    .map((ref) => ({ ref, score: words.filter((word) => ref.toLowerCase().includes(word)).length }))
    .filter((item) => item.score > 0)
    .toSorted((a, b) => b.score - a.score || a.ref.localeCompare(b.ref))
    .slice(0, limit)
    .map((item) => item.ref)
}

/** `providerID/modelID`, split at the first slash: model ids may contain slashes of their own. */
export function parse(text: string) {
  const [providerID = "", ...rest] = text.trim().split("/")
  return { providerID, modelID: rest.join("/") }
}

export type Result =
  | { readonly type: "invalid"; readonly message: string }
  | {
      readonly type: "page"
      readonly title: string
      readonly output: string
      readonly total: number
      readonly count: number
      readonly next?: string
    }

/**
 * One page of the models a subagent can run on: the caller's own provider first, then the others,
 * newest first, and one per family unless `all` is set.
 */
export function search(entries: ReadonlyArray<Entry>, params: Parameters, own?: string): Result {
  const offset = params.cursor === undefined ? 0 : Number(params.cursor)
  if (!Number.isInteger(offset) || offset < 0)
    return { type: "invalid", message: `Invalid cursor "${params.cursor}": pass the cursor a previous page returned.` }
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(params.limit ?? DEFAULT_LIMIT)))
  const wanted = params.provider?.trim().toLowerCase()
  const words = params.query?.toLowerCase().split(/\s+/u).filter(Boolean) ?? []
  const matching = entries
    .filter((model) => !wanted || model.providerID.toLowerCase() === wanted || model.provider.toLowerCase() === wanted)
    .filter((model) => (params.capabilities ?? []).every((capability) => has(model, capability)))
    .filter((model) => {
      const text = `${model.providerID}/${model.id} ${model.name}`.toLowerCase()
      return words.every((word) => text.includes(word))
    })
    .toSorted(
      (a, b) =>
        Number(b.providerID === own) - Number(a.providerID === own) ||
        a.providerID.localeCompare(b.providerID) ||
        b.released.localeCompare(a.released) ||
        a.id.localeCompare(b.id),
    )
    // Sorted newest first within a provider, so the first of a family is its newest.
    .filter(
      (model, index, sorted) =>
        params.all ||
        !model.family ||
        sorted.findIndex((other) => other.providerID === model.providerID && other.family === model.family) === index,
    )
  const page = matching.slice(offset, offset + limit)
  const next = offset + limit < matching.length ? String(offset + limit) : undefined
  const title = params.query ? `Models: ${params.query}` : "Models"
  if (page.length === 0)
    return {
      type: "page",
      title,
      output:
        matching.length === 0
          ? "No model matches. Loosen the query, drop the provider or capability filter, or pass all: true."
          : `No models past cursor ${offset}; ${matching.length} match in total.`,
      total: matching.length,
      count: 0,
    }
  return {
    type: "page",
    title,
    output: [
      `Models ${offset + 1}-${offset + page.length} of ${matching.length}${own ? `, your provider (${own}) first` : ""}, newest first${params.all ? "" : ", one per family"}. Pass the id as the task tool's model and a listed variant as its variant.`,
      ...page.map((model) => `- ${line(model)}`),
      ...(next ? [`More models: call again with cursor "${next}".`] : []),
    ].join("\n"),
    total: matching.length,
    count: page.length,
    ...(next ? { next } : {}),
  }
}

function has(model: Entry, capability: Capability) {
  if (capability === "reasoning") return model.reasoning
  if (capability === "tool_call") return model.toolCall
  return model.attachments
}

function line(model: Entry) {
  return [
    `${model.providerID}/${model.id}`,
    model.name,
    `provider ${model.provider}`,
    `context ${model.limit.context} tokens, output ${model.limit.output}`,
    ...(model.variants.length ? [`variants: ${model.variants.join(", ")}`] : []),
    ...(model.cost ? [`$${model.cost.input} input, $${model.cost.output} output per 1M tokens`] : []),
    ...(model.released ? [`released ${model.released}`] : []),
  ].join(" · ")
}
