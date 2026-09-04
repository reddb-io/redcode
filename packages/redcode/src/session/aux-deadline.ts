/**
 * Bounds for the model calls a turn makes that are not the turn itself.
 *
 * Naming the session, and compacting it when the context fills, both call a provider outside the
 * step loop. Neither is covered by the turn's inactivity watchdog — the watchdog reads a step
 * handle, and these either have none or have one of their own — so a provider that stops answering
 * during either of them holds the turn open with nothing on screen and no error.
 *
 * Neither is the work the user asked for, so both can fail without the turn failing: a session
 * keeps its default name, and a compaction that did not happen is reported as itself.
 */

/** Naming a session is one short request against a small model. */
export const TITLE_MS = 120_000

/** Compacting reads the whole conversation back, so it is allowed to take real time. */
export const COMPACTION_MS = 600_000

export type Call = "title" | "compaction"

const DEFAULTS: Record<Call, number> = { title: TITLE_MS, compaction: COMPACTION_MS }

export function deadlineMs(call: Call, configured?: number | false): number | undefined {
  if (configured === false) return undefined
  if (configured === undefined) return DEFAULTS[call]
  return configured > 0 ? configured : undefined
}

export function message(call: Call, ms: number) {
  const what = call === "title" ? "Naming the session" : "Compacting the conversation"
  return `${what} got no answer from the provider within ${Math.round(ms / 1000)}s and was given up on.`
}

export * as AuxDeadline from "./aux-deadline"
