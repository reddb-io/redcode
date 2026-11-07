import { ModelLimit } from "../../model-limit.js"
import type { ModelsDev } from "../../models-dev.js"

export type Limit = { readonly context: number; readonly output: number }
export type CatalogLimits = ReadonlyMap<string, Limit>
export type CatalogModels = ReadonlyMap<string, ModelsDev.Snapshot["models"][number]>

/**
 * The limits for a model that neither its endpoint, its configuration nor the models catalog describes: a guess that
 * keeps proactive compaction working, held back by the estimate reserve since it is as likely too large as too small.
 * A guess is resolved again on every load and never written to configuration; a configuration an older version
 * froze it into is recognised by these numbers and resolved again.
 */
export const undescribedLimit: Limit = { context: ModelLimit.conservative(128_000), output: 8_192 }

const limitsBySnapshot = new WeakMap<readonly ModelsDev.Snapshot[], CatalogLimits>()
const modelsBySnapshot = new WeakMap<readonly ModelsDev.Snapshot[], CatalogModels>()

/**
 * The context and output limits the models catalog knows, by model id. The first provider that lists an id with a
 * known context wins. Shared across the Locations reading the same catalog.
 */
export function catalogLimits(catalog: readonly ModelsDev.Snapshot[]): CatalogLimits {
  const cached = limitsBySnapshot.get(catalog)
  if (cached) return cached
  const limits = new Map(
    catalog
      .flatMap((item) => item.models)
      .filter((model) => model.limit.context > 0)
      .map((model) => [String(model.id), { context: model.limit.context, output: model.limit.output }] as const)
      .toReversed(),
  )
  limitsBySnapshot.set(catalog, limits)
  return limits
}

/** Full catalog metadata by model id, for endpoints that list an id but omit capabilities and limits. */
export function catalogModels(catalog: readonly ModelsDev.Snapshot[]): CatalogModels {
  const cached = modelsBySnapshot.get(catalog)
  if (cached) return cached
  const models = new Map(
    catalog
      .flatMap((item) => item.models)
      .map((model) => [String(model.id), model] as const)
      .toReversed(),
  )
  modelsBySnapshot.set(catalog, models)
  return models
}

/**
 * What the catalog knows about a model an endpoint lists, though the endpoint did not describe it. An exact id wins;
 * gateways and routers prefix upstream ids (`openai/gpt-4o`, `cc/claude-sonnet`), so leading segments are dropped
 * until the catalog knows one. Failing that, the id is compared normalised: case, a `:variant` or `@region` suffix
 * and dots against dashes in version numbers are the differences gateways introduce without naming another model.
 * Nothing shorter than the model's own name is ever matched, so `glm-5.3-flash` never resolves to `glm-5.3`.
 */
export function knownLimit(limits: CatalogLimits, id: string) {
  return known(limits, id)
}

/** Full metadata for a known endpoint model, using the same conservative id matching as `knownLimit`. */
export function knownModel(models: CatalogModels, id: string) {
  return known(models, id)
}

type Index<T> = {
  readonly full: ReadonlyMap<string, T>
  readonly suffix: ReadonlyMap<string, T>
}

const indexByEntries = new WeakMap<object, Index<unknown>>()

function known<T>(entries: ReadonlyMap<string, T>, id: string) {
  const forms = segments(id)
  const exact = forms.map((form) => entries.get(form)).find((entry) => entry !== undefined)
  if (exact) return exact
  const index = normalisedIndex(entries)
  return forms
    .map((form) => normalise(form))
    .map((form) => index.full.get(form) ?? index.suffix.get(form))
    .find((entry) => entry !== undefined)
}

/** The catalog's ids normalised, in full and with their own leading segments dropped; the first id wins each form. */
function normalisedIndex<T>(entries: ReadonlyMap<string, T>): Index<T> {
  const cached = indexByEntries.get(entries)
  if (cached) return cached as Index<T>
  const full = new Map<string, T>()
  const suffix = new Map<string, T>()
  for (const [id, entry] of entries) {
    const [own, ...rest] = segments(id).map((form) => normalise(form))
    if (!full.has(own)) full.set(own, entry)
    for (const form of rest) if (!suffix.has(form)) suffix.set(form, entry)
  }
  const index = { full, suffix }
  indexByEntries.set(entries, index as Index<unknown>)
  return index
}

/** The id and the ids left by dropping its leading `/` segments one at a time. */
function segments(id: string) {
  const parts = id.split("/")
  return parts.map((_, start) => parts.slice(start).join("/"))
}

/** Lower case, without a `:variant` or `@region` suffix on the model's own segment, dots in versions written as dashes. */
function normalise(id: string) {
  const parts = id.toLowerCase().split("/")
  const model = parts[parts.length - 1].replace(/[:@].*$/, "").replace(/\./g, "-")
  return [...parts.slice(0, -1), model].join("/")
}
