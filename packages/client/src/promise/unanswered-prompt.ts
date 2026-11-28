import type { SessionMessageInfo } from "./generated/types.js"

/** Select a sent prompt that can be restored without removing an answer or tool work. */
export function unansweredPrompt(messages: ReadonlyArray<SessionMessageInfo>) {
  const index = messages.findLastIndex((message) => message.type === "user")
  const prompt = messages[index]
  if (prompt?.type !== "user") return undefined
  const answered = messages.slice(index + 1).some((message) => {
    if (message.type === "compaction" || message.type === "shell" || message.type === "synthetic") return true
    return message.type === "assistant" && message.content.some(
      (part) => part.type === "tool" || (part.type === "text" && part.text.trim() !== ""),
    )
  })
  return answered ? undefined : prompt
}
