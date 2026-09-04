/**
 * When a turn has stopped making progress, and what to do about it.
 *
 * Kept pure and separate from the loop so every branch is testable without timers, fibers or a
 * provider. The loop supplies the observations; this decides.
 *
 * The distinction that matters: silence is not the same as a stall. Tools run inside the provider
 * SDK and emit nothing at all while they work, so a turn running `cargo build` for half an hour is
 * silent and healthy. Only silence with nothing in flight is a stall.
 */

export type StallLimits = {
  /** Say something once the turn has been quiet this long. `Infinity` disables it. */
  readonly warnMs: number
  /** End the turn once it has been quiet this long. `Infinity` disables it. */
  readonly abortMs: number
}

export type StallInput = {
  readonly quietMs: number
  readonly activeToolCount: number
  readonly permissionPending: boolean
  readonly limits: StallLimits
}

export type StallDecision =
  | { readonly type: "working" }
  | { readonly type: "warn"; readonly quietMs: number }
  | { readonly type: "abort"; readonly quietMs: number; readonly reason: string }

/** Well clear of a slow model's thinking time, well inside the timeouts that eventually fire. */
export const STALL_WARN_MS_DEFAULT = 300_000
export const STALL_ABORT_MS_DEFAULT = 600_000

export function decide(input: StallInput): StallDecision {
  // A person deciding whether to approve a command is not a stalled turn.
  if (input.permissionPending) return { type: "working" }
  // Neither is a tool that is still running, however long it takes.
  if (input.activeToolCount > 0) return { type: "working" }
  if (input.quietMs >= input.limits.abortMs) {
    return { type: "abort", quietMs: input.quietMs, reason: `no output for ${describe(input.quietMs)}` }
  }
  if (input.quietMs >= input.limits.warnMs) return { type: "warn", quietMs: input.quietMs }
  return { type: "working" }
}

/** Rounded the way someone reading a status line would say it, not to the millisecond. */
export function describe(ms: number) {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`
}

/**
 * A warning has to leave room for the turn to recover: activity can still arrive and make the
 * abort never happen, so it must not be worded as though it already had.
 */
export function warning(quietMs: number, limits: StallLimits) {
  const tail = Number.isFinite(limits.abortMs) ? `, ending it at ${describe(limits.abortMs)} unless it resumes` : ""
  return `No output for ${describe(quietMs)}${tail}`
}

/**
 * Turn configuration into limits, and decide where ending a turn is appropriate at all.
 *
 * Ending someone's turn while they are sitting in front of it takes a decision away from them;
 * the warning is enough there, because they can see it and press escape. Where nothing is
 * watching — a scripted run, an editor speaking ACP, a scheduled job — nobody will ever press
 * anything, so silence is the whole failure and ending it is the only useful act.
 */
export function limits(
  config: false | { readonly warn_ms?: number; readonly abort_ms?: number } | undefined,
  options: { readonly attended?: boolean } = {},
): StallLimits {
  if (config === false) return { warnMs: Infinity, abortMs: Infinity }
  const warnMs = config?.warn_ms ?? STALL_WARN_MS_DEFAULT
  const configured = config?.abort_ms ?? STALL_ABORT_MS_DEFAULT
  const abortMs = options.attended ? Infinity : configured
  // A warning that arrives after the abort would never be seen.
  return { warnMs: Math.min(warnMs, abortMs), abortMs }
}

/**
 * How often to look. Frequent enough that a threshold is honoured rather than rounded up to the
 * next poll, cheap enough that a healthy turn costs nothing: half the nearest threshold, capped.
 */
export function pollMs(limits: StallLimits) {
  const nearest = Math.min(limits.warnMs, limits.abortMs)
  if (!Number.isFinite(nearest)) return POLL_MAX_MS
  return Math.max(POLL_MIN_MS, Math.min(POLL_MAX_MS, Math.round(nearest / 2)))
}

export const POLL_MIN_MS = 100
const POLL_MAX_MS = 15_000

export * as SessionStall from "./stall"
