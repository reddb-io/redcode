import type { ModelInfo, SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { Locale } from "./locale"

type SessionNode = {
  id: string
  parentID?: string | null
}

export function sessionFamily<T extends SessionNode>(sessions: readonly T[], sessionID: string) {
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const current = byID.get(sessionID)
  if (!current) return []

  const children = new Map<string, T[]>()
  sessions.forEach((session) => {
    if (!session.parentID) return
    const group = children.get(session.parentID)
    if (group) group.push(session)
    else children.set(session.parentID, [session])
  })

  function root(session: T): T {
    const parent = session.parentID ? byID.get(session.parentID) : undefined
    return parent ? root(parent) : session
  }

  function walk(parentID: string, ancestors: boolean[]): Array<{ session: T; prefix: string }> {
    const group = children.get(parentID) ?? []
    return group.flatMap((session, index) => {
      const last = index === group.length - 1
      const prefix =
        ancestors.length === 0
          ? ""
          : ancestors
              .slice(1)
              .map((ancestor) => (ancestor ? "   " : "│  "))
              .join("") + (last ? "└─ " : "├─ ")
      return [{ session, prefix }, ...walk(session.id, [...ancestors, last])]
    })
  }

  return walk(root(current).id, [])
}

export function lastAssistantWithUsage(messages: ReadonlyArray<SessionMessageInfo>, boundary?: string) {
  const boundaryIndex = boundary ? messages.findIndex((message) => message.id === boundary) : -1
  if (boundary && boundaryIndex === -1) return undefined
  const end = boundaryIndex === -1 ? messages.length : boundaryIndex
  const compactionIndex = messages.findLastIndex(
    (message, index) => message.type === "compaction" && message.status === "completed" && index < end,
  )
  return messages.findLast(
    (message, index): message is SessionMessageAssistant & { tokens: NonNullable<SessionMessageAssistant["tokens"]> } =>
      message.type === "assistant" && message.tokens !== undefined && index > compactionIndex && index < end,
  )
}

export function contextUsage(
  messages: ReadonlyArray<SessionMessageInfo>,
  models: ReadonlyArray<ModelInfo> | undefined,
  boundary?: string,
) {
  const last = lastAssistantWithUsage(messages, boundary)
  if (!last) return
  const tokens =
    last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  if (tokens <= 0) return
  const model = models?.find((model) => model.providerID === last.model.providerID && model.id === last.model.id)
  // The window the percentage is of, so a reading over 100% can be told from the window the model is believed
  // to have. The model entry carries no provenance, so whether that window was reported, cataloged or guessed is
  // not known here.
  const limit = model?.limit.context ? model.limit.context : undefined
  return {
    tokens,
    limit,
    percent: limit === undefined ? undefined : Math.round((tokens / limit) * 100),
  }
}

// The runner's own wording for a quota or usage limit (`SessionRunnerRetry`), applied to what the event carries.
const QUOTA_PATTERN = /quota|usage limit|insufficient[_\s]credits|credit balance/i

/**
 * The status line of a turn waiting to retry: which model it waits for and, when the failure names a
 * quota, when it resets. A quota's retry waits at least as long as the provider asked, so the retry
 * instant stands for the reset.
 */
export function retryStatus(input: {
  model: string
  retry: NonNullable<SessionMessageAssistant["retry"]>
  seconds: number
}) {
  const error = input.retry.error
  const quota = error.type === "provider.quota" || error.status === 402 || QUOTA_PATTERN.test(error.message)
  return [
    input.seconds > 0 ? `Retrying in ${input.seconds}s` : "Retry due",
    quota ? `${input.model} quota exhausted until ${Locale.time(input.retry.at)}` : input.model,
    `attempt ${input.retry.attempt}`,
    error.message,
  ]
    .filter(Boolean)
    .join(" · ")
}

/** `14.1K / 200.0K (7%)` once the window is known, `14.1K` until then. */
export function formatContextUsage(tokens: number, percent?: number, limit?: number) {
  const value = limit === undefined ? Locale.number(tokens) : `${Locale.number(tokens)} / ${Locale.number(limit)}`
  return percent === undefined ? value : `${value} (${percent}%)`
}
