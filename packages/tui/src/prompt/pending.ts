// Prompts admitted to a session and not yet delivered, as the prompt footer and `/pending` show them.

type PendingLike = { delivery: "steer" | "queue"; files: number }

export function pendingPreview(text: string, width = 72) {
  const line = text.trim().split("\n")[0] ?? ""
  const shown = line.length > width ? line.slice(0, width - 1) + "…" : line
  return shown || "(no text)"
}

export function pendingLabel(item: PendingLike) {
  const files = item.files > 0 ? ` · ${item.files} file${item.files === 1 ? "" : "s"}` : ""
  if (item.delivery === "steer") return `steer: next safe step of the running session${files}`
  return `queued: runs when the current session becomes idle${files}`
}
