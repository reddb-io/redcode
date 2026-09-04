import type { SessionV1 } from "@reddb-io/redcode-core/v1/session"

/**
 * Turns left behind by a process that died mid-flight.
 *
 * `time.completed` on an assistant message is written by the process running the turn. When that
 * process is killed — an OOM, a machine going to sleep, a crash — nobody writes it, and the
 * message stays open forever. The TUI reads an open assistant message as "a turn is in progress"
 * and stamps QUEUED on everything typed after it, so a session that survived an OOM looks jammed
 * from then on, across restarts, with no way for the user to tell it apart from a real queue.
 *
 * A turn interrupted while the process lives finalizes itself on the way out. So an open message
 * found at the start of a fresh run belongs to a run that is no longer there.
 */
export const ORPHAN_MESSAGE = "The process ended before this turn finished."

export function orphans(messages: readonly SessionV1.WithParts[]): SessionV1.Assistant[] {
  return messages.flatMap((item) =>
    item.info.role === "assistant" && !item.info.time.completed ? [item.info] : [],
  )
}

export * as SessionOrphan from "./orphan"
