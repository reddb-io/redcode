/**
 * Sizing a request before it is sent.
 *
 * The provider's count for the last request is the best measure of what the next one carries:
 * only what history gained since has to be estimated, scaled by what the provider counted the
 * last time it refused a request from this model. A request with no count behind it is measured
 * by the character estimate alone, which is off by a third either way and depends on the content
 * (code, prose, other scripts, images), so it may start a compaction but never refuses a request:
 * the provider decides, and its refusal teaches the limit.
 */
export * as SessionPreflight from "./preflight"

import { ModelLimit } from "@reddb-io/redcode-core/model-limit"
import type { SessionV1 } from "@reddb-io/redcode-core/v1/session"

/** Overflow recoveries, before a request or after a refusal, allowed while answering one turn. */
export const MAX_RECOVERIES = 2

/** Input tokens the provider counted for a finished request. */
export const counted = (tokens: SessionV1.Assistant["tokens"]) => tokens.input + tokens.cache.read + tokens.cache.write

export type Projection = {
  readonly tokens: number
  /** Whether the projection rests on the provider's count, or on the character estimate alone. */
  readonly anchored: boolean
}

/**
 * The input tokens the request about to be sent carries, or nothing when neither a provider count
 * nor a lesson makes the estimate worth acting on.
 */
export const project = (input: {
  /** The estimate for the request about to be sent: system prompt, tools and messages. */
  readonly estimate: number
  /** The provider's count for the last request, and the estimate of what history gained since. */
  readonly last?: { readonly counted: number; readonly gained: number }
  readonly observed?: ModelLimit.Observed
}): Projection | undefined => {
  if (input.last && input.last.counted > 0)
    return {
      tokens: input.last.counted + ModelLimit.calibrate(Math.max(0, input.last.gained), input.observed),
      anchored: true,
    }
  // The lesson's ratio came from one request's content; it is not applied to a whole other one.
  if (input.observed) return { tokens: input.estimate, anchored: false }
  return undefined
}

/**
 * Whether the projected request exceeds the limit. A limit learned from the provider is
 * authoritative. The catalog's limit is not: a provider that already accepted more than it says
 * has shown the catalog wrong, and the request is sent for the provider to decide.
 */
export const exceeds = (input: {
  readonly projection: Projection | undefined
  readonly limit: number
  /** What the provider accepted for the last request, when known. */
  readonly accepted?: number
  readonly observed?: ModelLimit.Observed
}) => {
  if (input.projection === undefined || input.limit <= 0 || input.projection.tokens <= input.limit) return false
  if (input.observed) return true
  return (input.accepted ?? 0) <= input.limit
}

/**
 * Whether a request that still exceeds the limit after compaction had its chances is refused
 * rather than sent: only when the provider's own count says so against a limit the provider
 * itself taught us. Anything weaker is sent, and the provider decides.
 */
export const refusable = (input: { readonly projection: Projection; readonly observed?: ModelLimit.Observed }) =>
  input.projection.anchored && input.observed !== undefined

/** The projection in the shape the compaction service reads counts in. */
export const tokens = (projected: number): SessionV1.Assistant["tokens"] => ({
  input: projected,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
})
