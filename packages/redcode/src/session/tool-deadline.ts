/**
 * How long a tool may run before it is treated as wedged.
 *
 * Most tools have no bound at all today: a read on a dead network mount, an LSP request to a
 * server that stopped answering, or an MCP call to a process that went away holds the whole turn
 * with no output and no error. The turn's own inactivity watchdog cannot help, because a tool in
 * flight is deliberately counted as work.
 *
 * A timeout here is an ordinary tool failure, not a crash: the model sees it, can say so, and can
 * try something else.
 */

import { Duration, Effect } from "effect"

/** Generous on purpose. This is a backstop against wedging, not a performance budget. */
export const TOOL_DEADLINE_DEFAULT_MS = 600_000

/**
 * Tools that must not be bounded from here.
 *
 * `shell` carries its own deadline and lets the model choose it, so a deliberately long build is a
 * legitimate call rather than a hang. `question` exists to wait for a person. `task` runs a whole
 * child turn, which has its own watchdog — bounding it here would cut a subagent mid-thought and
 * report it as a stuck tool.
 */
const UNBOUNDED = new Set(["shell", "bash", "question", "task"])

export function deadlineMs(input: { tool: string; configured?: number | false }): number | undefined {
  if (UNBOUNDED.has(input.tool)) return undefined
  if (input.configured === false) return undefined
  const ms = input.configured ?? TOOL_DEADLINE_DEFAULT_MS
  return ms > 0 ? ms : undefined
}

export function message(input: { tool: string; ms: number }) {
  const minutes = Math.round(input.ms / 60_000)
  const how = minutes >= 1 ? `${minutes}m` : `${Math.round(input.ms / 1000)}s`
  return `The ${input.tool} tool was still running after ${how} and was stopped. It may be waiting on something that will not answer; try a different approach, or narrow what you asked it to do.`
}

/** How often the guard re-checks. Small enough for tests, coarse enough to cost nothing. */
export const POLL_MS = 250

/**
 * Bound a tool call without charging it for time a person spent deciding.
 *
 * A permission dialog left open all afternoon is not a hung tool, so the clock is checked against
 * elapsed time minus whatever `waitedMs` reports as human deliberation. Written as a race rather
 * than a plain timeout precisely so that subtraction can happen while the call is in flight.
 */
export const guard = <A, E, R>(
  self: Effect.Effect<A, E, R>,
  input: { tool: string; ms: number; waitedMs: () => number },
): Effect.Effect<A, E, R> =>
  Effect.raceFirst(
    self,
    Effect.gen(function* () {
      const start = Date.now()
      const step = Duration.millis(Math.max(1, Math.min(input.ms, POLL_MS)))
      while (Date.now() - start - input.waitedMs() < input.ms) yield* Effect.sleep(step)
      return yield* Effect.die(new Error(message(input)))
    }),
  )

export * as ToolDeadline from "./tool-deadline"
