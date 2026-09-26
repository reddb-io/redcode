export * as SessionLoopGuard from "./loop-guard-v2.js"

import type { ToolCall } from "@opencode/ai"
import { SessionMessage } from "./message.js"
import { LoopGuard } from "./loop-guard.js"

/** Adapt projected V2 messages to the detector's settled-call history. */
export function assess(messages: readonly SessionMessage.Info[], next: ToolCall, limits: LoopGuard.Limits) {
  const ordered = messages.toReversed()
  const lastUser = ordered.findLastIndex((message) => message.type === "user")
  // A bounded read without its user boundary could join two separate turns.
  if (lastUser === -1 && messages.length === 120) return { type: "ok" } as const
  const parts: LoopGuard.Part[] = ordered.slice(lastUser + 1).flatMap((message) => {
    if (message.type !== "assistant") return []
    return message.content.flatMap((part): LoopGuard.Part[] => {
      if (part.type === "text") return [{ type: "text", text: part.text }]
      if (part.type !== "tool") return []
      if (part.state.status === "completed")
        return [{
          type: "tool",
          tool: part.name,
          state: {
            status: "completed",
            input: part.state.input,
            output: part.state.content.some((item) => item.type !== "text")
              ? JSON.stringify(part.state.content)
              : part.state.content.map((item) => item.type === "text" ? item.text : "").join("\n"),
          },
        }]
      if (part.state.status === "error")
        return [{
          type: "tool",
          tool: part.name,
          state: { status: "error", input: part.state.input, error: part.state.error.message },
        }]
      return []
    })
  })
  return LoopGuard.assess({ parts, next: { tool: next.name, input: next.input }, limits })
}
