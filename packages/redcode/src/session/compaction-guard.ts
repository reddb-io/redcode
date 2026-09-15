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
import { COMPACTION_GUARD_PAUSE } from "@reddb-io/redcode-core/session/loop-marker"

export { COMPACTION_GUARD_PAUSE, EFFECTIVE_RATIO, MAX_AUTO_PER_TURN, PAUSE_AFTER_INEFFECTIVE, isEffective }

const KEY = "compaction"

/** Share of the usable window after which an unattended run is asked to wrap up. */
export const WRAP_UP_RATIO = 0.95

export type State = {
  /** Automatic compactions in a row, within `turn`, that left the context above the band. */
  readonly ineffective: number
  /** The turn those compactions served; a new turn starts the count over. */
  readonly turn?: string
  /** Set while automatic compaction is paused; lifted by a user message newer than `after`. */
  readonly paused?: { readonly after: string; readonly at: number }
}

export const CONTINUE =
  "Continue the user's latest request. Re-read the recent messages kept above the summary; if they supersede the summary, follow them. Do not redo work already completed. If no work remains, stop."

export const HANDOFF = "The user sent new messages while the conversation was being compacted. Handle them."

export const WRAP_UP =
  "Context is nearly full. Finish the current step, record progress in the task list, and stop calling tools unless essential."

export const NOTICE_TITLE = "Compaction paused"

const band = `${Math.round(EFFECTIVE_RATIO * 100)}% of the usable context`

export const PAUSED = `Automatic compaction is paused: ${PAUSE_AFTER_INEFFECTIVE} compactions in a row could not bring this conversation under ${band}, so the turn stopped instead of compacting again. Run /compact to try again, or start a new session. Sending a new message also resumes automatic compaction.`

export const LIMIT = `This turn was compacted ${MAX_AUTO_PER_TURN} times in a row without getting the conversation under ${band}, so it stopped instead of compacting again. Run /compact, or start a new session.`

/** Why a goal was paused by the guard, in the form its continuation recognises on resume. */
export const goalReason = (hold: "paused" | "limit") =>
  `${COMPACTION_GUARD_PAUSE}${hold === "paused" ? `${PAUSE_AFTER_INEFFECTIVE} compactions in a row` : `${MAX_AUTO_PER_TURN} compactions in this turn`} left the context above ${band}`

export function fromMetadata(metadata: Record<string, unknown> | undefined): State {
  const raw = metadata?.[KEY]
  if (!raw || typeof raw !== "object") return { ineffective: 0 }
  const value = raw as Record<string, unknown>
  const ineffective = typeof value.ineffective === "number" && value.ineffective > 0 ? value.ineffective : 0
  const paused = value.paused as Record<string, unknown> | undefined
  return {
    ineffective,
    ...(typeof value.turn === "string" ? { turn: value.turn } : {}),
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

/**
 * The state after one automatic compaction. `latestRequestID` names the person's request it
 * served, `turnID` the turn (a goal continuation is a new turn of the same request).
 */
export function afterAutomatic(
  state: State,
  input: {
    readonly effective: boolean
    readonly latestRequestID: string | undefined
    readonly turnID: string | undefined
    readonly now: number
  },
): State {
  if (input.effective) return { ineffective: 0 }
  // A pause lifted by a newer request, or a new turn, starts the count over: two ineffective
  // compactions days apart are not a cycle.
  const fresh = (state.paused && !isPaused(state, input.latestRequestID)) || state.turn !== input.turnID
  const ineffective = (fresh ? 0 : state.ineffective) + 1
  const turn = input.turnID
  if (ineffective < PAUSE_AFTER_INEFFECTIVE) return { ineffective, ...(turn ? { turn } : {}) }
  return { ineffective, ...(turn ? { turn } : {}), paused: { after: input.latestRequestID ?? "", at: input.now } }
}

/** Unattended runs get one wrap-up reminder once this little of the usable window is left. */
export function wrapUpDue(input: { readonly count: number; readonly usable: number }) {
  return input.usable > 0 && input.count >= input.usable * WRAP_UP_RATIO && input.count < input.usable
}

export * as CompactionGuard from "./compaction-guard"
