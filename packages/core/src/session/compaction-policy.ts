/**
 * Sizing rules shared by the legacy and v2 compaction: how much recent history stays verbatim,
 * how long a summary may be, and when old tool output is worth trimming. Pure, so both runtimes
 * agree and every branch is testable without a provider.
 */

/** Share of the usable window kept verbatim after a compaction. */
export const TAIL_RATIO = 0.1
export const MIN_TAIL_TOKENS = 8_000
export const MAX_TAIL_TOKENS = 60_000
/** In a small window the kept tail never takes more than this share, or nothing is summarized. */
export const MAX_TAIL_SHARE = 0.25
/** Upper bound on the summary's output tokens, below the model's own output limit. */
export const SUMMARY_MAX_TOKENS = 32_000
/** Trimming old tool output is only worth a cache miss when it frees at least this much. */
export const PRUNE_MINIMUM_SAVINGS = 20_000
/** The last user turns whose tool output is never trimmed. */
export const PRUNE_PROTECTED_TURNS = 2
/** How long a provider keeps a prompt prefix cached when nothing refreshes it. */
export const CACHE_TTL_MS = 5 * 60_000

/**
 * Tokens of recent history kept verbatim: `preserve_recent_tokens` when configured, otherwise a
 * tenth of the usable window clamped to [8k, 60k], and never more than a quarter of that window.
 */
export const tailBudget = (input: { readonly usable: number; readonly configured?: number }) => {
  if (input.configured !== undefined) return input.configured
  const proportional = Math.min(MAX_TAIL_TOKENS, Math.max(MIN_TAIL_TOKENS, Math.floor(input.usable * TAIL_RATIO)))
  return Math.max(0, Math.min(proportional, Math.floor(input.usable * MAX_TAIL_SHARE)))
}

/** The summary's output budget: `summary_max_tokens` when configured, otherwise capped at 32k. */
export const summaryMaxTokens = (output: number | undefined, configured?: number) => {
  const cap = configured !== undefined && configured > 0 ? configured : SUMMARY_MAX_TOKENS
  return output !== undefined && output > 0 ? Math.min(output, cap) : cap
}

/**
 * What the model reads in place of a trimmed tool result. The trim is permanent, and running the
 * tool again may repeat its side effects, so the model is pointed at the stored output instead.
 */
export const trimPlaceholder = (input: { readonly tokens: number; readonly tool: string }) =>
  `[tool output trimmed: ${input.tokens} tokens from ${input.tool}. If you still need it, find it with session_history instead of running the tool again.]`

/**
 * Whether the provider's cached prefix is already gone: nothing was sent yet, or the session has
 * been idle longer than the cache lives. Trimming then costs no cache that is still paid for.
 */
export const cacheCold = (input: { readonly lastRequestAt?: number; readonly now: number; readonly ttl?: number }) =>
  input.lastRequestAt === undefined || input.now - input.lastRequestAt > (input.ttl ?? CACHE_TTL_MS)

export * as CompactionPolicy from "./compaction-policy"
