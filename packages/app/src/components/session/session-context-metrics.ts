import type { AssistantMessage, Message } from "@reddb-io/redcode-sdk/v2/client"
import { GenerationTiming } from "@reddb-io/redcode-core/session/generation-timing"

type Provider = {
  id: string
  name?: string
  models: Record<string, Model | undefined>
}

type Model = {
  name?: string
  limit: {
    context: number
  }
}

type Context = {
  message: AssistantMessage
  provider?: Provider
  model?: Model
  providerLabel: string
  modelLabel: string
  limit: number | undefined
  input: number
  total: number
  usage: number | null
  /**
   * The latest measured step and its turn, chosen by the rules the TUI uses too: compaction
   * summaries, replays and messages from before timing was recorded are skipped.
   */
  meter?: GenerationTiming.Meter<Message>
}

export const formatLatency = (ms: number | undefined, locale?: string) =>
  ms === undefined ? "—" : GenerationTiming.formatLatency(ms, locale)

/** A rate, or the reason there is none: `burst` for output that arrived all at once. */
export const formatSpeed = (speed: GenerationTiming.Speed | undefined, locale: string | undefined, burst: string) => {
  if (speed?.type === "rate") return GenerationTiming.formatRate(speed.value, locale)
  if (speed?.type === "burst") return burst
  return "—"
}

const tokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

const lastAssistantWithTokens = (messages: Message[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (tokenTotal(msg) <= 0) continue
    return msg
  }
}

const build = (messages: Message[] = [], providers: Provider[] = []): Context | undefined => {
  const message = lastAssistantWithTokens(messages)
  if (!message) return undefined

  const provider = providers.find((item) => item.id === message.providerID)
  const model = provider?.models[message.modelID]
  const limit = model?.limit.context
  const total = tokenTotal(message)

  return {
    message,
    provider,
    model,
    providerLabel: provider?.name ?? message.providerID,
    modelLabel: model?.name ?? message.modelID,
    limit,
    input: message.tokens.input,
    total,
    usage: limit ? Math.round((total / limit) * 100) : null,
    meter: GenerationTiming.meter(messages),
  }
}

export function getSessionContext(messages: Message[] = [], providers: Provider[] = []) {
  return build(messages, providers)
}
