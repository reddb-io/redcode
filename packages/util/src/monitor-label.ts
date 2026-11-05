import { Redact } from "./redact.js"

/** Compact diagnostic label; remove terminal controls and known secrets before displaying it. */
export function monitorLabel(monitor: { id: string; command: string }) {
  const clean = (value: string) =>
    Redact.redact(
      Redact.redactURLs(
        value
          .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
          .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      ),
    )
  const id = clean(monitor.id).slice(0, 80) || "monitor"
  const text = clean(monitor.command)
  if (!text) return id
  const short = text.length > 100 ? `${text.slice(0, 99)}…` : text
  return `${short} (${id})`
}
