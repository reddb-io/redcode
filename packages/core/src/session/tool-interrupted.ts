export * as ToolInterrupted from "./tool-interrupted.js"

import type { SessionMessage } from "./message.js"

/**
 * Prefix of the durable error a tool call gets when its step is interrupted, cancelled or its process
 * died. The durable record keeps this short fact; the model-visible wording below is derived from it.
 */
export const MESSAGE = "Tool execution interrupted"

/**
 * A bare "interrupted" reads as "did not happen", and a model that believes that runs the side effect a
 * second time, so a call that may change state says plainly that its outcome is unknown.
 */
export const RESULT =
  "This tool call was cancelled or interrupted before it finished. Its outcome is unknown: it may not have run, or it may have partly run. Check the current state before repeating it."

export const READ_ONLY_RESULT =
  "This tool call was cancelled or interrupted before it finished. It only reads, so nothing changed; run it again if you still need its result."

/** Said once, on the user message that follows an interrupted step, so the cached prefix holds. */
export const NOTE =
  "The previous turn was cancelled or interrupted before it finished. Tool calls it left unfinished are marked as cancelled and their outcome is unknown. Check the current state before repeating any action with side effects, and do not redo work that already completed. Continue from here."

/** How much of a stopped call's captured output rides along with its result. */
export const PARTIAL_MAX_CHARS = 2_000

/** Tools that never change files, processes or session state. Every other tool may have partly run. */
const READ_ONLY = new Set([
  "read",
  "grep",
  "glob",
  "lsp",
  "webfetch",
  "websearch",
  "skill",
  "session_history",
  "design_read",
  "design_detect",
  "design_history",
  "design_jobs",
  "goal_status",
  "list_mcp_resources",
  "read_mcp_resource",
])

export const readOnly = (tool: string) => READ_ONLY.has(tool)

export const interrupted = (error: SessionMessage.ToolStateError["error"]) =>
  error.type === "aborted" && error.message.startsWith(MESSAGE)

/** The model-visible text for an interrupted call: the recorded detail, the outcome, and any captured output. */
export function result(input: { readonly tool: string; readonly detail: string; readonly partial?: unknown }) {
  const outcome = `${input.detail}. ${readOnly(input.tool) ? READ_ONLY_RESULT : RESULT}`
  if (typeof input.partial !== "string" || input.partial.trim() === "") return outcome
  const tail =
    input.partial.length > PARTIAL_MAX_CHARS
      ? `[${input.partial.length - PARTIAL_MAX_CHARS} earlier characters omitted]\n${input.partial.slice(-PARTIAL_MAX_CHARS)}`
      : input.partial
  return `${outcome}\n\nOutput captured before it stopped:\n${tail}`
}

/** Whether an assistant step ended interrupted, so the next user message carries {@link NOTE}. */
export const stepInterrupted = (message: SessionMessage.Assistant) =>
  message.error?.type === "aborted" ||
  message.content.some((item) => item.type === "tool" && item.state.status === "error" && interrupted(item.state.error))
