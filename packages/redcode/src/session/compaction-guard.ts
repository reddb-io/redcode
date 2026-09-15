/**
 * The rules that keep automatic compaction from cycling near the context limit.
 *
 * Kept pure so every branch is testable without a provider. The loop and the compaction service
 * supply the observations; this decides, and the session metadata carries the state across a
 * restart so a reopened session does not start the cycle over.
 */
import {
  EFFECTIVE_RATIO,
  MAX_AUTO_PER_TURN,
  PAUSE_AFTER_INEFFECTIVE,
  isEffective,
} from "@reddb-io/redcode-core/session/compaction"

export { EFFECTIVE_RATIO, MAX_AUTO_PER_TURN, PAUSE_AFTER_INEFFECTIVE, isEffective }

const KEY = "compaction"

/** Share of the usable window after which an unattended run is asked to wrap up. */
export const WRAP_UP_RATIO = 0.95

export type State = {
  /** Automatic compactions in a row that left the context above the hysteresis band. */
  readonly ineffective: number
  /** Set while automatic compaction is paused; lifted by a user message newer than `after`. */
  readonly paused?: { readonly after: string; readonly at: number }
}

export const CONTINUE =
  "Continue the user's latest request. Re-read the recent messages kept above the summary; if they supersede the summary, follow them. Do not redo work already completed. If no work remains, stop."

export const HANDOFF = "The user sent new messages while the conversation was being compacted. Handle them."

export const WRAP_UP =
  "Context is nearly full. Finish the current step, record progress in the task list, and stop calling tools unless essential."

export const PAUSED =
  "Automatic compaction is paused: the last compactions could not bring this conversation under the model's context limit, so the turn stopped instead of compacting again. Run /compact to try again, or start a new session. Sending a new message also resumes automatic compaction."

export const LIMIT = `The conversation was compacted ${MAX_AUTO_PER_TURN} times in this turn and is still over the model's context limit, so the turn stopped instead of compacting again. Run /compact, or start a new session.`

export function fromMetadata(metadata: Record<string, unknown> | undefined): State {
  const raw = metadata?.[KEY]
  if (!raw || typeof raw !== "object") return { ineffective: 0 }
  const value = raw as Record<string, unknown>
  const ineffective = typeof value.ineffective === "number" && value.ineffective > 0 ? value.ineffective : 0
  const paused = value.paused as Record<string, unknown> | undefined
  return {
    ineffective,
    ...(paused && typeof paused.after === "string" && typeof paused.at === "number"
      ? { paused: { after: paused.after, at: paused.at } }
      : {}),
  }
}

export function toMetadata(metadata: Record<string, unknown> | undefined, state: State): Record<string, unknown> {
  const { [KEY]: _, ...rest } = metadata ?? {}
  if (state.ineffective === 0 && !state.paused) return rest
  return { ...rest, [KEY]: state }
}

/** Paused until a user message newer than the one current when the pause started. */
export function isPaused(state: State, latestRequestID: string | undefined) {
  if (!state.paused) return false
  return latestRequestID === undefined || latestRequestID <= state.paused.after
}

/** The state after one automatic compaction; `latestRequestID` names the request it served. */
export function afterAutomatic(
  state: State,
  input: { readonly effective: boolean; readonly latestRequestID: string | undefined; readonly now: number },
): State {
  // A pause that a newer request lifted starts the count over.
  const base = state.paused && !isPaused(state, input.latestRequestID) ? { ineffective: 0 } : state
  if (input.effective) return { ineffective: 0 }
  const ineffective = base.ineffective + 1
  if (ineffective < PAUSE_AFTER_INEFFECTIVE) return { ineffective }
  return { ineffective, paused: { after: input.latestRequestID ?? "", at: input.now } }
}

/** Unattended runs get one wrap-up reminder once this little of the usable window is left. */
export function wrapUpDue(input: { readonly count: number; readonly usable: number }) {
  return input.usable > 0 && input.count >= input.usable * WRAP_UP_RATIO && input.count < input.usable
}

export * as CompactionGuard from "./compaction-guard"
