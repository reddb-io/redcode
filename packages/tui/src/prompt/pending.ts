// Prompts admitted to a session and not yet promoted, as the prompt footer and `/pending` show them.

type PendingLike = { delivery: "steer" | "queue"; stale: boolean; files: number }

/** One line of a prompt's text, short enough for a list row. */
export function pendingPreview(text: string, width = 72) {
  const line = text.trim().split("\n")[0] ?? ""
  const shown = line.length > width ? line.slice(0, width - 1) + "…" : line
  return shown || "(no text)"
}

export function pendingLabel(item: PendingLike) {
  const files = item.files > 0 ? ` · ${item.files} file${item.files === 1 ? "" : "s"}` : ""
  if (item.stale) return `held: missed its turn, sent only if you send it${files}`
  if (item.delivery === "steer") return `steer: next step of the running turn${files}`
  return `queued: runs when the current turn ends${files}`
}

/**
 * The footer notice for held prompts, or `undefined` when none is held. Queued and steered prompts
 * are already shown in the transcript while the turn runs; a held one is not going anywhere on its
 * own, so it is named until someone sends or discards it.
 */
export function heldNotice(items: readonly PendingLike[]) {
  const held = items.filter((item) => item.stale).length
  if (held === 0) return undefined
  return `${held} held prompt${held === 1 ? "" : "s"} · /pending`
}
