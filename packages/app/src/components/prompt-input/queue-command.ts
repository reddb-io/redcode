import type { Prompt } from "@/context/prompt"

export const QUEUE_SLASH = "queue"

const promptText = (prompt: Prompt) => prompt.map((part) => ("content" in part ? part.content : "")).join("")

/**
 * `/queue <text>` sends `<text>` queued: it waits until the running turn ends instead of steering
 * the turn at its next step. Returns the prompt without the command prefix, with the offsets of the
 * parts after it moved back by its length, or `undefined` when the prompt does not start with it.
 */
export function stripQueueCommand(prompt: Prompt): Prompt | undefined {
  const match = /^\/queue(?:[ \t]+|\n|$)/.exec(promptText(prompt))
  if (!match) return undefined
  const cut = match[0].length
  return prompt.flatMap<Prompt[number]>((part, index) => {
    if (!("content" in part)) return [part]
    // The prefix ends in whitespace or the end of the text, so only text parts can overlap it.
    const offset = promptText(prompt.slice(0, index)).length
    const content = part.type === "text" ? part.content.slice(Math.max(0, cut - offset)) : part.content
    if (part.type === "text" && !content && offset < cut) return []
    return [{ ...part, content, start: Math.max(0, part.start - cut), end: Math.max(0, part.end - cut) }]
  })
}
