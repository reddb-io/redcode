export * as ModelPricing from "./model-pricing.js"

import { Option, Schema } from "effect"
import type { LLMRequest, Usage, UsageMeter } from "@opencode/ai"
import type { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import type { TokenUsage } from "@opencode/schema/token-usage"

type Scalar = string | number | boolean
export type Facts = Readonly<Record<string, Scalar | readonly Scalar[] | undefined>>
export type Meter = UsageMeter
export type Quote = { readonly amount: Money.USD } | { readonly reason: string }

const json = Schema.Record(Schema.String, Schema.Json)
const positive = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const Cache = Schema.Struct({
  read: Schema.optional(positive),
  write: Schema.optional(Schema.Union([positive, Schema.Record(Schema.String, positive)])),
  storage: Schema.optional(positive),
})
const CachePrices = Schema.Struct({ ...Cache.fields, explicit: Schema.optional(Cache) })
const fields = { price: positive, reasoning: Schema.optional(positive), cache: Schema.optional(CachePrices) }
const Override = Schema.Struct({
  when: Schema.Json,
  price: Schema.optional(positive),
  reasoning: Schema.optional(positive),
  cache: Schema.optional(CachePrices),
})
const Rate = Schema.Struct({
  ...fields,
  unit: Schema.optional(Schema.String),
  overrides: Schema.optional(Schema.Array(Override)),
})
const Modality = Schema.Struct({ input: Schema.optional(Rate), output: Schema.optional(Rate) })
const Pricing = Schema.Struct({
  text: Schema.optional(Modality),
  image: Schema.optional(Modality),
  audio: Schema.optional(Modality),
  video: Schema.optional(Modality),
  web_search: Schema.optional(Rate),
  multipliers: Schema.optional(Schema.Array(Schema.Struct({ when: Schema.Json, factor: Schema.Json }))),
})
const Scalar = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean])
const Comparable = Schema.Union([Schema.String, Schema.Finite])
const Predicate = Schema.Union([
  Schema.Struct({ equals: Scalar }),
  Schema.Struct({ in: Schema.Array(Scalar) }),
  Schema.Struct({ gt: Comparable }),
  Schema.Struct({ gte: Comparable }),
  Schema.Struct({ lt: Comparable }),
  Schema.Struct({ lte: Comparable }),
  Schema.Struct({ min_items: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }),
])
const keys = new Set([
  "context",
  "duration",
  "megapixels",
  "input_images",
  "service_tier",
  "region",
  "date",
  "utc_days",
  "utc_hours",
  "holiday",
  "thinking",
  "resolution",
  "quality",
  "aspect_ratio",
  "generate_audio",
  "mode",
  "input_video",
  "fps",
  "steps",
  "search_context_size",
])
type Match = "yes" | "no" | "unknown" | "skip"

/** Quotes exactly the supplied meters. Missing facts or unsupported dimensions never become free. */
export function quote(raw: unknown, meters: readonly Meter[], facts: Facts = {}): Quote {
  const decoded = Schema.decodeUnknownOption(Pricing, { onExcessProperty: "error" })(raw)
  if (Option.isNone(decoded)) return { reason: "missing-or-invalid-pricing" }
  return evaluate(decoded.value, meters, facts)
}

function evaluate(pricing: typeof Pricing.Type, meters: readonly Meter[], facts: Facts): Quote {
  const amounts = meters
    .filter((meter) => meter.quantity !== 0)
    .map((meter): Quote => {
      if (!Number.isFinite(meter.quantity) || meter.quantity < 0) return { reason: "invalid-meter-quantity" }
      const modality =
        meter.modality === "text"
          ? pricing.text
          : meter.modality === "image"
            ? pricing.image
            : meter.modality === "audio"
              ? pricing.audio
              : meter.modality === "video"
                ? pricing.video
                : undefined
      const base =
        meter.direction === "search" && meter.modality === "web_search"
          ? pricing.web_search
          : meter.direction === "input"
            ? modality?.input
            : meter.direction === "output"
              ? modality?.output
              : undefined
      if (!base) return { reason: `missing-price:${meter.modality}.${meter.direction}` }
      const unit = base.unit ?? (meter.direction === "search" ? "search" : "token")
      if (!["token", "character", "image", "megapixel", "second", "minute", "search"].includes(unit))
        return { reason: `unsupported-unit:${unit}` }
      if (unit !== meter.unit) return { reason: `unit-mismatch:${unit}:${meter.unit}` }
      const resolved = resolve(base, facts)
      if ("reason" in resolved) return resolved
      const cache = meter.cacheMode === "explicit" ? (resolved.cache?.explicit ?? resolved.cache) : resolved.cache
      if (
        (cache?.storage ?? 0) > 0 &&
        !meters.some(
          (entry) =>
            entry.modality === meter.modality &&
            entry.direction === meter.direction &&
            entry.component === "cache.storage",
        )
      )
        return { reason: "unmetered-cache-storage" }
      if (meter.component?.startsWith("cache.") && resolved.cache?.explicit && !meter.cacheMode)
        return { reason: "cache-mode-not-reported" }
      const component = meter.component ?? "price"
      const value =
        component === "price"
          ? resolved.price
          : component === "reasoning"
            ? (resolved.reasoning ?? resolved.price)
            : component === "cache.read"
              ? cache?.read
              : component === "cache.storage"
                ? cache?.storage
                : typeof cache?.write === "number"
                  ? cache.write
                  : meter.cacheTTL
                    ? cache?.write?.[meter.cacheTTL]
                    : undefined
      if (value === undefined) return { reason: `missing-price:${component}` }
      const path = [
        meter.modality,
        ...(meter.direction === "search" ? [] : [meter.direction]),
        ...(component.startsWith("cache.") && meter.cacheMode === "explicit" && resolved.cache?.explicit
          ? ["cache", "explicit", ...component.split(".").slice(1)]
          : component === "reasoning" && resolved.reasoning === undefined
            ? ["price"]
            : component.split(".")),
        ...(component === "cache.write" && typeof cache?.write === "object" && meter.cacheTTL ? [meter.cacheTTL] : []),
      ]
      const factors = (pricing.multipliers ?? []).map((rule) => {
        const match = when(rule.when, facts)
        if (match === "unknown") return undefined
        if (match !== "yes") return 1
        return factor(rule.factor, path)
      })
      if (factors.some((value) => value === undefined)) return { reason: "unresolved-multiplier" }
      const denominator = unit === "token" || unit === "character" ? 1_000_000 : unit === "search" ? 1_000 : 1
      const amount = (meter.quantity * value * factors.reduce<number>((total, item) => total * item!, 1)) / denominator
      return Number.isFinite(amount) && amount >= 0
        ? { amount: Money.USD.make(amount) }
        : { reason: "invalid-price-result" }
    })
  const unresolved = amounts.find((entry) => "reason" in entry)
  if (unresolved) return unresolved
  const amount = amounts.reduce((sum, entry) => sum + ("amount" in entry ? entry.amount : 0), 0)
  return Number.isFinite(amount) && amount >= 0
    ? { amount: Money.USD.make(amount) }
    : { reason: "invalid-price-result" }
}

export function tokens(catalog: Model.Catalog, usage: TokenUsage.Info, facts: Facts = {}): Quote {
  const decoded = Schema.decodeUnknownOption(Pricing, { onExcessProperty: "error" })(catalog.pricing)
  if (Option.isNone(decoded)) return { reason: "missing-or-invalid-pricing" }
  return evaluate(
    decoded.value,
    [
      { modality: "text", direction: "input", unit: "token", quantity: usage.input },
      { modality: "text", direction: "input", unit: "token", quantity: usage.cache.read, component: "cache.read" },
      { modality: "text", direction: "input", unit: "token", quantity: usage.cache.write, component: "cache.write" },
      { modality: "text", direction: "output", unit: "token", quantity: usage.output },
      { modality: "text", direction: "output", unit: "token", quantity: usage.reasoning, component: "reasoning" },
    ],
    { ...facts, context: usage.input + usage.cache.read + usage.cache.write },
  )
}

/** A detailed token breakdown must reconcile with the normalized inclusive usage before it can replace it. */
export function usage(catalog: Model.Catalog, record: Usage, facts: Facts = {}): Quote {
  if (!record.meters)
    return tokens(
      catalog,
      {
        input: record.nonCachedInputTokens ?? 0,
        output: record.visibleOutputTokens,
        reasoning: record.reasoningTokens ?? 0,
        cache: { read: record.cacheReadInputTokens ?? 0, write: record.cacheWriteInputTokens ?? 0 },
      },
      facts,
    )
  const expected = [
    { direction: "input", component: "price", quantity: record.nonCachedInputTokens ?? 0 },
    { direction: "input", component: "cache.read", quantity: record.cacheReadInputTokens ?? 0 },
    { direction: "input", component: "cache.write", quantity: record.cacheWriteInputTokens ?? 0 },
    { direction: "output", component: "price", quantity: record.visibleOutputTokens },
    { direction: "output", component: "reasoning", quantity: record.reasoningTokens ?? 0 },
  ]
  if (
    expected.some(
      (entry) =>
        entry.quantity !==
        record
          .meters!.filter(
            (meter) =>
              meter.unit === "token" &&
              meter.direction === entry.direction &&
              (meter.component ?? "price") === entry.component,
          )
          .reduce((sum, meter) => sum + meter.quantity, 0),
    )
  )
    return { reason: "incomplete-token-meters" }
  return quote(catalog.pricing, record.meters, {
    ...facts,
    context:
      (record.nonCachedInputTokens ?? 0) + (record.cacheReadInputTokens ?? 0) + (record.cacheWriteInputTokens ?? 0),
  })
}

/** Request options are observed before provider lowering. Absent facts remain unknown. */
export function request(request: LLMRequest): Facts {
  const options = {
    ...request.model.defaults?.providerOptions,
    ...request.providerOptions,
    ...request.model.defaults?.http?.body,
    ...request.http?.body,
  }
  return Object.fromEntries(
    [...keys].flatMap((key) => {
      const value = options[key] ?? (key === "service_tier" ? options.serviceTier : undefined)
      return typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
        ? [[key, value]]
        : []
    }),
  )
}

function resolve(base: typeof Rate.Type, facts: Facts): typeof Rate.Type | { reason: string } {
  const matches = (base.overrides ?? []).map((rule) => ({ rule, match: when(rule.when, facts) }))
  if (matches.some((entry) => entry.match === "unknown")) return { reason: "missing-condition-facts" }
  return matches
    .filter((entry) => entry.match === "yes")
    .reduce(
      (value, { rule }) => ({
        ...value,
        ...(rule.price === undefined ? {} : { price: rule.price }),
        ...(rule.reasoning === undefined ? {} : { reasoning: rule.reasoning }),
        ...(rule.cache === undefined ? {} : { cache: mergeCache(value.cache, rule.cache) }),
      }),
      base,
    )
}

function mergeCache(
  base: typeof CachePrices.Type | undefined,
  patch: typeof CachePrices.Type,
): typeof CachePrices.Type {
  return {
    ...base,
    ...patch,
    ...(typeof base?.write === "object" && typeof patch.write === "object"
      ? { write: { ...base.write, ...patch.write } }
      : {}),
    ...(patch.explicit ? { explicit: mergeCache(base?.explicit, patch.explicit) } : {}),
  }
}

function when(raw: Schema.Json, facts: Facts): Match {
  const parsed = Schema.decodeUnknownOption(json)(raw)
  if (Option.isNone(parsed)) return "unknown"
  const matches = Object.entries(parsed.value).map(([key, value]): Match => {
    if (key === "all" || key === "any") {
      if (!Array.isArray(value)) return "unknown"
      const entries = value.map((item) => when(item, facts))
      if (entries.includes("skip")) return "skip"
      if (key === "all" && entries.includes("no")) return "no"
      if (key === "any" && entries.includes("yes")) return "yes"
      if (entries.includes("unknown")) return "unknown"
      return key === "all" ? "yes" : "no"
    }
    if (key === "not") {
      const match = when(value, facts)
      return match === "yes" ? "no" : match === "no" ? "yes" : match
    }
    if (!keys.has(key)) return "skip"
    const decoded = Schema.decodeUnknownOption(Predicate, { onExcessProperty: "error" })(value)
    if (Option.isNone(decoded)) return "unknown"
    const actual = facts[key]
    if (actual === undefined) return "unknown"
    const predicate = decoded.value
    if ("equals" in predicate) return actual === predicate.equals ? "yes" : "no"
    if ("in" in predicate) return predicate.in.some((item) => item === actual) ? "yes" : "no"
    if ("min_items" in predicate) return Array.isArray(actual) && actual.length >= predicate.min_items ? "yes" : "no"
    const expected =
      "gt" in predicate
        ? predicate.gt
        : "gte" in predicate
          ? predicate.gte
          : "lt" in predicate
            ? predicate.lt
            : predicate.lte
    if ((typeof actual !== "number" && typeof actual !== "string") || typeof actual !== typeof expected)
      return "unknown"
    return (
      "gt" in predicate
        ? actual > expected
        : "gte" in predicate
          ? actual >= expected
          : "lt" in predicate
            ? actual < expected
            : actual <= expected
    )
      ? "yes"
      : "no"
  })
  if (matches.includes("skip")) return "skip"
  if (matches.includes("no")) return "no"
  if (matches.includes("unknown")) return "unknown"
  return "yes"
}

function factor(value: Schema.Json, path: readonly string[]): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : undefined
  const record = Schema.decodeUnknownOption(json)(value)
  if (Option.isNone(record) || !path.length) return undefined
  const next = record.value[path[0]!]
  return next === undefined ? 1 : factor(next, path.slice(1))
}
