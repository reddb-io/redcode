/**
 * Sizing a request before it is sent.
 *
 * The provider's count for the last request is the best measure of what the next one carries:
 * only what history gained since has to be estimated, scaled by what the provider counted the
 * last time it refused a request from this model. Without a count and without a lesson from the
 * provider there is no evidence to refuse a request on: the character estimate alone is off by
 * a third either way, so the provider decides and its refusal teaches the limit.
 */
export * as SessionPreflight from "./preflight"

import { ModelLimit } from "@reddb-io/redcode-core/model-limit"
import type { SessionV1 } from "@reddb-io/redcode-core/v1/session"

/** Overflow recoveries, before a request or after a refusal, allowed while answering one turn. */
export const MAX_RECOVERIES = 2

/** Input tokens the provider counted for a finished request. */
export const counted = (tokens: SessionV1.Assistant["tokens"]) => tokens.input + tokens.cache.read + tokens.cache.write

/**
 * The input tokens the request about to be sent carries, or nothing when there is no evidence
 * beyond the character estimate.
 */
export const project = (input: {
  /** The estimate for the request about to be sent: system prompt, tools and messages. */
  readonly estimate: number
  /** The provider's count for the last request, and the estimate of what history gained since. */
  readonly last?: { readonly counted: number; readonly gained: number }
  readonly observed?: ModelLimit.Observed
}) => {
  if (input.last && input.last.counted > 0)
    return input.last.counted + ModelLimit.calibrate(Math.max(0, input.last.gained), input.observed)
  if (input.observed) return ModelLimit.calibrate(input.estimate, input.observed)
  return undefined
}

/**
 * Whether the provider would refuse the projected request. A limit learned from the provider is
 * authoritative. The catalog's limit is not: a provider that already accepted more than it says
 * has shown the catalog wrong, and the request is sent for the provider to decide.
 */
export const wouldRefuse = (input: {
  readonly projected: number | undefined
  readonly limit: number
  /** What the provider accepted for the last request, when known. */
  readonly accepted?: number
  readonly observed?: ModelLimit.Observed
}) => {
  if (input.projected === undefined || input.limit <= 0 || input.projected <= input.limit) return false
  if (input.observed) return true
  return (input.accepted ?? 0) <= input.limit
}

/** The projection in the shape the compaction service reads counts in. */
export const tokens = (projected: number): SessionV1.Assistant["tokens"] => ({
  input: projected,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
})
