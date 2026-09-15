/**
 * What the model reads for a tool call that never got a result.
 *
 * A cancelled turn, a stall stop, a provider error or a dead process can leave a tool call behind
 * without an outcome. Providers reject a call with no matching result, so one is always sent, and
 * it says plainly that the outcome is unknown: a bare "aborted" reads as "did not happen", and a
 * model that believes that runs the side effect a second time.
 */
export const RESULT =
  "This tool call was cancelled or interrupted before it finished. Its outcome is unknown: it may not have run, or it may have partly run. Check the current state before repeating it."

/** How much of a stopped call's streamed output rides along with the synthetic result. */
export const PARTIAL_MAX_CHARS = 2_000

export function result(partial?: unknown) {
  if (typeof partial !== "string" || partial.trim() === "") return RESULT
  const tail =
    partial.length > PARTIAL_MAX_CHARS
      ? `[${partial.length - PARTIAL_MAX_CHARS} earlier characters omitted]\n${partial.slice(-PARTIAL_MAX_CHARS)}`
      : partial
  return `${RESULT}\n\nOutput captured before it stopped:\n${tail}`
}

/** Said once on the turn after a cancelled one, as a trailing reminder so the cached prefix holds. */
export const NOTE =
  "The previous turn was cancelled or interrupted before it finished. Tool calls it left unfinished are marked as cancelled and their outcome is unknown. Check the current state before repeating any action with side effects, and do not redo work that already completed. Continue from here."

export * as ToolInterrupted from "./tool-interrupted"
