export * as SessionUsage from "./usage.js"

import type { LLMRequest, Usage } from "@opencode/ai"
import { CostAssessment } from "@opencode/schema/cost-assessment"
import { ModelPricing } from "../model-pricing.js"
import { Money } from "@opencode/schema/money"
import type { TokenUsage } from "@opencode/schema/token-usage"
import type { Model } from "@opencode/schema/model"

const finite = (value: number) => (Number.isFinite(value) ? value : 0)
const safe = (value: number | undefined) => Math.max(0, finite(value ?? 0))

export const tokens = (usage: Usage | undefined): TokenUsage.Info => ({
  input: safe(usage?.nonCachedInputTokens),
  output: safe(usage?.visibleOutputTokens),
  reasoning: safe(usage?.reasoningTokens),
  cache: {
    read: safe(usage?.cacheReadInputTokens),
    write: safe(usage?.cacheWriteInputTokens),
  },
})

// TODO(#35765): Use Copilot's reported billed amount once billing has a dedicated typed runtime contract.
export function calculateCost(costs: Model.Info["cost"], usage: TokenUsage.Info) {
  const context = usage.input + usage.cache.read + usage.cache.write
  const tier = costs
    .filter((cost) => cost.tier?.type === "context" && context > cost.tier.size)
    .toSorted((a, b) => (b.tier?.size ?? 0) - (a.tier?.size ?? 0))[0]
  const cost = tier ?? costs.find((cost) => cost.tier === undefined)
  if (!cost) return Money.USD.zero
  return Money.USD.make(
    (usage.input * finite(cost.input) +
      (usage.output + usage.reasoning) * finite(cost.output) +
      usage.cache.read * finite(cost.cache.read) +
      usage.cache.write * finite(cost.cache.write)) /
      1_000_000,
  )
}

export type Recorded = {
  readonly tokens: TokenUsage.Info
  readonly cost: Money.USD
  readonly costAssessment?: CostAssessment.Info
}
type PricingModel = {
  readonly cost: Model.Info["cost"]
  readonly catalog?: Model.Info["catalog"]
  readonly model?: Pick<LLMRequest["model"], "id" | "provider">
}

export function record(
  usage: Usage | undefined,
  model: Model.Info["cost"] | PricingModel,
  request?: LLMRequest,
): Recorded {
  const normalized = tokens(usage)
  if (usage?.cost !== undefined && Number.isFinite(usage.cost) && usage.cost >= 0)
    return { tokens: normalized, cost: Money.USD.make(usage.cost), costAssessment: { status: "reported" } }
  const missing =
    !usage ||
    [
      usage.nonCachedInputTokens,
      usage.outputTokens,
      usage.reasoningTokens,
      usage.cacheReadInputTokens,
      usage.cacheWriteInputTokens,
    ].every((value) => value === undefined)
  return estimate(normalized, model, request, missing)
}

export function estimate(
  normalized: TokenUsage.Info,
  model: Model.Info["cost"] | PricingModel,
  request?: LLMRequest,
  missingUsage = false,
): Recorded {
  const costs = "cost" in model ? model.cost : model
  const catalog = "cost" in model ? model.catalog : undefined
  const rich = catalog?.format === 2 && !costs.length
  const digest = rich ? { catalogDigest: catalog.digest } : {}
  const priced = costs.length
    ? { amount: calculateCost(costs, normalized) }
    : rich
      ? ModelPricing.tokens(catalog, normalized, request ? ModelPricing.request(request) : {})
      : { reason: "missing-pricing" }
  const reason = missingUsage
    ? "missing-usage"
    : request &&
        "cost" in model &&
        model.model &&
        (request.model.id !== model.model.id || request.model.provider !== model.model.provider)
      ? "replaced-request-model"
      : catalog?.format === 2 &&
          request &&
          (nativeTools(request.tools) ||
            request.messages.some((message) =>
              message.content.some(
                (part) =>
                  part.type === "media" ||
                  (part.type === "tool-result" &&
                    part.result.type === "content" &&
                    part.result.value.some((content) => content.type !== "text")),
              ),
            ))
        ? "unmetered-native-or-media-usage"
        : "reason" in priced
          ? priced.reason
          : !Number.isFinite(priced.amount) || priced.amount < 0
            ? "invalid-price-result"
            : undefined
  return {
    tokens: normalized,
    cost: reason || !("amount" in priced) ? Money.USD.zero : priced.amount,
    costAssessment: reason ? { status: "unknown", reason, ...digest } : { status: "estimated", ...digest },
  }
}

export const add = (a: Recorded, b: Recorded): Recorded => ({
  cost: Money.USD.make(a.cost + b.cost),
  ...(a.costAssessment || b.costAssessment
    ? {
        costAssessment:
          !a.costAssessment ||
          !b.costAssessment ||
          a.costAssessment.status === "unknown" ||
          b.costAssessment.status === "unknown"
            ? { status: "unknown" as const, reason: "incomplete-aggregate" }
            : {
                status:
                  a.costAssessment.status === "reported" && b.costAssessment.status === "reported"
                    ? ("reported" as const)
                    : ("estimated" as const),
              },
      }
    : {}),
  tokens: {
    input: a.tokens.input + b.tokens.input,
    output: a.tokens.output + b.tokens.output,
    reasoning: a.tokens.reasoning + b.tokens.reasoning,
    cache: { read: a.tokens.cache.read + b.tokens.cache.read, write: a.tokens.cache.write + b.tokens.cache.write },
  },
})

function nativeTools(tools: LLMRequest["tools"]): boolean {
  return tools.some((tool) => (tool.type === "tool" ? tool.native !== undefined : nativeTools(tool.tools)))
}
