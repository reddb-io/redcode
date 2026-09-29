import { isAttachment, promptLength } from "./prompt-parts"
import type { ContentPart, Prompt } from "./state"

export const QUEUE_SLASH = "queue"

/**
 * `/queue <text>` sends `<text>` queued: it waits until the running turn ends instead of steering
 * the turn at its next step. Returns the prompt without the command, the parts after it moved back
 * by its length, or `undefined` when the prompt does not start with it.
 */
export function stripQueueCommand(prompt: Prompt): Prompt | undefined {
  const text = prompt.map((part) => ("content" in part ? part.content : "")).join("")
  const cut = /^\/queue(?:[ \t]+|\n|$)/.exec(text)?.[0].length
  if (cut === undefined) return undefined
  return prompt.flatMap((part, index): ContentPart[] => {
    if (isAttachment(part)) return [part]
    const start = Math.max(0, part.start - cut)
    const end = Math.max(start, part.end - cut)
    // The command ends in whitespace or the end of the text, so only text parts can overlap it.
    if (part.type !== "text") return [{ ...part, start, end }]
    const offset = promptLength(prompt.slice(0, index))
    const content = part.content.slice(Math.max(0, cut - offset))
    if (!content && offset < cut) return []
    return [{ ...part, content, start, end }]
  })
}
