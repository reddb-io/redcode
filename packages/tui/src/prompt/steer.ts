// Steering vs queueing from the prompt.
//
// A submitted prompt is admitted to the session inbox with a delivery: `queue` waits until the
// running turn would otherwise go idle, `steer` is promoted at the next safe step boundary of the
// running turn without interrupting the tool that is running. On an idle session both run right
// away, so the delivery is always sent and no client-side status check can race the server.
// Enter queues; the steer key (shift+return, only while the session works) or `/steer <text>` steers.

export type PromptIntent = "submit" | "steer"
export type Delivery = "steer" | "queue"

/** Session status type as the TUI stores it (`idle`, `busy`, `retry`, ...). */
export function isBusy(statusType: string | undefined) {
  return statusType !== undefined && statusType !== "idle"
}

/** The delivery a prompt is sent with. */
export function promptDelivery(intent: PromptIntent): Delivery {
  return intent === "steer" ? "steer" : "queue"
}

/**
 * The steer key only means "steer" while the session works; on an idle session it falls through
 * to the textarea, where the same key may insert a newline.
 */
export function steerKeyActive(input: { focused: boolean; disabled: boolean; statusType: string | undefined }) {
  return input.focused && !input.disabled && isBusy(input.statusType)
}

export const STEER_SLASH = "steer"

/**
 * `/steer <text>` is the steer fallback that works in every terminal. Returns the text to steer
 * with (possibly empty), or `undefined` when the input is not a steer command.
 */
export function parseSteerCommand(input: string): string | undefined {
  const prefix = steerPrefixLength(input)
  return prefix === undefined ? undefined : input.slice(prefix)
}

function steerPrefixLength(input: string) {
  const match = /^\/steer(?:[ \t]+|\n|$)/.exec(input)
  return match ? match[0].length : undefined
}

type Span = { start: number; end: number }
type SourcedPart = { type: string; source?: unknown }

function shiftSpan<T extends Span>(span: T, by: number): T {
  return { ...span, start: Math.max(0, span.start - by), end: Math.max(0, span.end - by) }
}

function isSpan(value: unknown): value is Span {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Span).start === "number" &&
    typeof (value as Span).end === "number"
  )
}

/**
 * Strips `/steer` from the prompt text and moves the parts' text offsets (file and symbol parts
 * keep them under `source.text`, agent parts directly under `source`) by the removed prefix, so a
 * message restored into the prompt still lines its mentions up with the text.
 */
export function stripSteerCommand<P extends SourcedPart>(
  text: string,
  parts: readonly P[],
): { text: string; parts: P[] } | undefined {
  const prefix = steerPrefixLength(text)
  if (prefix === undefined) return undefined
  return {
    text: text.slice(prefix),
    parts: parts.map((part) => {
      const source = part.source
      if (typeof source !== "object" || source === null) return part
      const nested = (source as { text?: unknown }).text
      if (isSpan(nested)) return { ...part, source: { ...source, text: shiftSpan(nested, prefix) } } as P
      if (isSpan(source)) return { ...part, source: shiftSpan(source, prefix) } as P
      return part
    }),
  }
}

/** Whether a terminal without keyboard enhancements would report the steer key as a plain return. */
export function steerKeyAmbiguous(steerKey: string, kittyKeyboard: boolean | undefined) {
  if (kittyKeyboard !== false) return false
  return /shift\+(return|enter)/i.test(steerKey)
}

/**
 * The hint shown next to the prompt while the session works. With `queued`, the steer key acts on
 * the prompt already waiting in the queue rather than on what is typed, and says so.
 */
export function busyHint(input: {
  submitKey: string
  steerKey: string
  kittyKeyboard?: boolean
  queued?: boolean
}) {
  const parts: string[] = []
  const what = input.queued === true ? "steer queued" : "steer"
  if (input.submitKey) parts.push(`${input.submitKey} queue`)
  if (input.steerKey && !steerKeyAmbiguous(input.steerKey, input.kittyKeyboard))
    parts.push(`${input.steerKey} ${what}`)
  else parts.push(`/${STEER_SLASH} ${what}`)
  return parts.join(" · ")
}

type PendingMessageLike = { id: string; role: string; time: { created: number; completed?: number } }

/**
 * Index of the assistant message the session is working on, or `undefined` when nothing is running.
 * An open assistant message alone is not a turn: a process killed mid-turn never writes
 * `time.completed`, so the session has to actually be working for anything to be waiting on it.
 */
export function pendingAssistantIndex(messages: readonly PendingMessageLike[], statusType: string | undefined) {
  if (!isBusy(statusType)) return undefined
  const completed = messages.findLastIndex((message) => message.role === "assistant" && message.time.completed)
  const pending = messages.findLastIndex(
    (message, index) => index > completed && message.role === "assistant" && !message.time.completed,
  )
  return pending === -1 ? undefined : pending
}

/**
 * The most recent prompt waiting behind the running turn that is not already a steer — the one
 * "steer queued" acts on. `undefined` when nothing is waiting.
 */
export function latestQueuedPrompt(input: {
  messages: readonly PendingMessageLike[]
  statusType: string | undefined
  /**
   * Whether this prompt is known not to be waiting in the queue any more: already steered, or
   * already promoted. Position in the transcript cannot answer that on its own — promotion
   * re-stamps the message to now, so a prompt the loop has just taken up still sits after the open
   * assistant message, and steering it again would only earn a 404.
   */
  settled: (messageID: string) => boolean
}) {
  const pending = pendingAssistantIndex(input.messages, input.statusType)
  if (pending === undefined) return undefined
  const queued = input.messages.findLast(
    (message, index) => index > pending && message.role === "user" && !input.settled(message.id),
  )
  return queued?.id
}

export type PendingBadge = { label: string; tone: "steer" | "queue" }

/** Badge for a user message that is admitted but not yet promoted. */
export function pendingBadge(steer: boolean): PendingBadge {
  if (steer) return { label: "STEER", tone: "steer" }
  return { label: "QUEUED", tone: "queue" }
}

export type SteeredAt = "mid-turn" | "idle"

export function steeredLabel(at: SteeredAt) {
  return at === "mid-turn" ? "↳ steered mid-turn" : "↳ steered"
}

type MessageLike = {
  id: string
  role: string
  finish?: string
  time: { created: number; completed?: number }
}

/**
 * Where a steer landed, judged when its promotion arrives: mid-turn when the assistant message
 * before it is still open or ended on tool calls (a step boundary), otherwise at an idle boundary.
 */
export function steeredAt(messages: readonly MessageLike[], messageID: string): SteeredAt {
  const previous = messages.findLast((message) => message.role === "assistant" && message.id !== messageID)
  if (!previous) return "idle"
  if (!previous.time.completed) return "mid-turn"
  return previous.finish === "tool-calls" || previous.finish === "unknown" ? "mid-turn" : "idle"
}
