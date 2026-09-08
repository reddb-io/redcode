import type { Part } from "@reddb-io/redcode-sdk/v2"

/** A finished planning review may keep Plan active; only an accepted handoff authorizes Build. */
export function modeTransition(part: Part) {
  if (part.type !== "tool" || part.state.status !== "completed") return
  if (part.tool === "plan_exit") return part.state.metadata.agent === "build" ? "build" : undefined
  if (part.tool === "design_exit") return part.state.metadata.agent === "plan" ? "plan" : undefined
  if (part.tool === "plan_enter") return "plan"
}
