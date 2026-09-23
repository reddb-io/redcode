import { ReasoningAuto } from "@reddb-io/redcode-core/session/reasoning-auto"

/**
 * What the prompt footer says about an `auto` session's effort, from the `reasoning` record the
 * server keeps in the session metadata: "auto → high · frustration" when Redcode chose the level,
 * "router: medium" when RedRouter did, plain "auto" before the first turn.
 */
export function reasoningLabel(metadata: Record<string, unknown> | undefined) {
  const shown = metadata?.["reasoning"]
  if (!shown || typeof shown !== "object") return ReasoningAuto.AUTO
  const record = shown as Record<string, unknown>
  const level = typeof record["level"] === "string" ? record["level"] : undefined
  if (!level) return ReasoningAuto.AUTO
  if (record["decider"] === "router") return `router: ${level}`
  const cause = typeof record["cause"] === "string" ? readableCause(record["cause"]) : undefined
  return cause ? `auto → ${level} · ${cause}` : `auto → ${level}`
}

/** The level an assistant message applied for an `auto` turn, for its footer: "auto → high". */
export function appliedLabel(asked: string | undefined, applied: string | undefined) {
  if (asked !== ReasoningAuto.AUTO || !applied || applied === ReasoningAuto.AUTO) return undefined
  return `auto → ${applied}`
}

// Causes that only say where the level came from are not worth the room.
const QUIET = new Set(["assessment", "kept", "default", "hold", "dwell"])

function readableCause(cause: string) {
  const parts = cause.split("+")
  const shown = QUIET.has(parts[0] ?? "") ? parts.slice(1) : parts
  return shown.join(" + ").replaceAll("_", " ") || undefined
}
