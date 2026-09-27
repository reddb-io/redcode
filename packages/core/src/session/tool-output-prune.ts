export * as SessionToolOutputPrune from "./tool-output-prune.js"

import type { Document, Entry } from "@opencode/schema/config"
import type { Content } from "@opencode/schema/tool"
import type { SessionMessage } from "./message.js"
import { Token } from "../util/token.js"

const MINIMUM_SAVINGS = 20_000
const PROTECTED_TURNS = 2
const DEFAULT_KEEP = 15_000

export type Settings = { readonly enabled: boolean; readonly keep: number }

export const settings = (entries: readonly Entry[]): Settings => {
  const documents = entries.filter((entry): entry is Document => entry.type === "document")
  return {
    enabled: documents.findLast((entry) => entry.info.compaction?.prune !== undefined)?.info.compaction?.prune ?? true,
    keep:
      documents.findLast((entry) => entry.info.compaction?.keep?.tokens !== undefined)?.info.compaction?.keep
        ?.tokens ?? DEFAULT_KEEP,
  }
}

/** Shape only the model-facing copy. The projected message retains the complete output. */
export const apply = (
  messages: readonly SessionMessage.Info[],
  options: Settings = { enabled: true, keep: DEFAULT_KEEP },
  tools?: { readonly definitions: readonly { readonly name: string }[] },
): readonly SessionMessage.Info[] => {
  if (!options.enabled || (tools && !tools.definitions.some((tool) => tool.name === "session_history"))) return messages

  let turns = 0
  let kept = 0
  let exhausted = false
  const candidates: { message: number; part: number; tokens: number; placeholder: string }[] = []
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type === "user") turns++
    if (message.type === "compaction" && message.status === "completed") break
    if (message.type !== "assistant" || turns < PROTECTED_TURNS) continue
    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex--) {
      const part = message.content[partIndex]!
      if (part.type !== "tool" || part.name === "skill" || part.state.status !== "completed") continue
      if (!part.state.content.every((item) => item.type === "text")) continue
      const tokens = part.state.content.reduce(
        (sum, item) => sum + (item.type === "text" ? Token.estimate(item.text) : 0),
        0,
      )
      if (!tokens) continue
      if (!exhausted && kept + tokens <= options.keep) {
        kept += tokens
        continue
      }
      exhausted = true
      candidates.push({
        message: index,
        part: partIndex,
        tokens,
        placeholder: `[tool output trimmed: ${tokens} tokens from ${part.name}. Retrieve the original with session_history({messageID:"${message.id}",toolCallID:"${part.id}"}) instead of running the tool again.]`,
      })
    }
  }
  const savings = candidates.reduce((sum, candidate) => sum + candidate.tokens - Token.estimate(candidate.placeholder), 0)
  if (savings < MINIMUM_SAVINGS) return messages

  const selected = new Map(candidates.map((candidate) => [`${candidate.message}:${candidate.part}`, candidate.placeholder]))
  return messages.map((message, index) => {
    if (message.type !== "assistant" || !message.content.some((_, part) => selected.has(`${index}:${part}`))) return message
    return {
      ...message,
      content: message.content.map((part, partIndex) => {
        const placeholder = selected.get(`${index}:${partIndex}`)
        if (placeholder === undefined || part.type !== "tool" || part.state.status !== "completed") return part
        return { ...part, state: { ...part.state, content: [{ type: "text", text: placeholder }] as [Content] } }
      }),
    }
  })
}
