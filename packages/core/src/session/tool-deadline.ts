/**
 * How long a tool may run before it is treated as wedged.
 *
 * Most tools have no bound at all today: a read on a dead network mount, an LSP request to a
 * server that stopped answering, or an MCP call to a process that went away holds the whole Step
 * with no output and no error. The Step inactivity watchdog cannot help, because a tool in
 * flight is deliberately counted as work.
 *
 * A timeout here is an ordinary tool failure, not a crash: the model sees it, can say so, and can
 * try something else.
 */

import { Clock, Duration, Effect, Exit } from "effect"
import { Tool } from "@opencode/schema/tool"

/** Generous on purpose. This is a backstop against wedging, not a performance budget. */
export const TOOL_DEADLINE_DEFAULT_MS = 600_000

/**
 * Tools that must not be bounded from here.
 *
 * `shell` carries its own deadline and lets the model choose it, so a deliberately long build is a
 * legitimate call rather than a hang. `question` exists to wait for a person. `task` runs a whole
 * child Session, which has its own watchdog — bounding it here would cut a subagent mid-thought and
 * report it as a stuck tool. `monitor` waits on an observation and caps its own wait at a minute;
 * a configured tool timeout below that must not turn a deliberate wait into a wedged tool.
 * `execute` runs a code mode script under its own timeout; bounding it here would stop the script
 * while it waits on nested calls.
 */
const UNBOUNDED = new Set(["shell", "bash", "question", "task", "monitor", "execute"])

export function deadlineMs(input: { tool: string; configured?: number | false }): number | undefined {
  if (UNBOUNDED.has(input.tool)) return undefined
  if (input.configured === false) return undefined
  const ms = input.configured ?? TOOL_DEADLINE_DEFAULT_MS
  return ms > 0 ? ms : undefined
}

export function message(input: { tool: string; ms: number }) {
  const minutes = Math.round(input.ms / 60_000)
  const how = minutes >= 1 ? `${minutes}m` : `${Math.round(input.ms / 1000)}s`
  return `The ${input.tool} tool exceeded ${how} and timed out. It may be waiting on something that will not answer; try a different approach, or narrow what you asked it to do.`
}

/** How often the guard re-checks. Small enough for tests, coarse enough to cost nothing. */
export const POLL_MS = 250

/**
 * Bound a tool call without charging it for time a person spent deciding.
 *
 * A permission dialog left open all afternoon is not a hung tool, so the clock is checked against
 * elapsed time minus whatever `waitedMs` reports as human deliberation. Written as a race rather
 * than a plain timeout precisely so that subtraction can happen while the call is in flight.
 *
 * Losing the race does not reach the tool by itself. Interrupting an `Effect.promise` leaves the
 * promise running: the model would be told the edit or fetch failed while it carried on and landed
 * later. The call receives an abort signal
 * of its own; the expiry path aborts it before settling the tool as failed.
 */
export const guard = <A, E, R>(
  self: (abort: AbortSignal) => Effect.Effect<A, E, R>,
  input: {
    tool: string
    ms: number
    /** Human wait so far, measured against `now` from the same clock the deadline reads. */
    waitedMs: (now: number) => number
    abort?: AbortSignal
    onExpire?: Effect.Effect<void>
  },
): Effect.Effect<A, E | Tool.Error, R> => {
  const own = new AbortController()
  const abort = input.abort ? AbortSignal.any([input.abort, own.signal]) : own.signal
  const reason = new Tool.Error({ message: message(input) })
  let expired = false
  return Effect.gen(function* () {
    const result = yield* Effect.raceFirst(
      self(abort),
      Effect.gen(function* () {
        // Use the same clock as the wait intervals, including under a test clock.
        const start = yield* Clock.currentTimeMillis
        const step = Duration.millis(Math.max(1, Math.min(input.ms, POLL_MS)))
        while (true) {
          const now = yield* Clock.currentTimeMillis
          if (now - start - input.waitedMs(now) >= input.ms) break
          yield* Effect.sleep(step)
        }
        expired = true
        own.abort(reason)
        return yield* reason
      }),
    ).pipe(Effect.exit)
    // An aborted cooperative tool can settle before the timeout fiber publishes its failure.
    if (expired) {
      if (input.onExpire) yield* Effect.uninterruptible(input.onExpire)
      return yield* reason
    }
    if (Exit.isFailure(result)) return yield* Effect.failCause(result.cause)
    return result.value
  }).pipe(Effect.ensuring(Effect.sync(() => own.abort())))
}

export * as ToolDeadline from "./tool-deadline.js"
