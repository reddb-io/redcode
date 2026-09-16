// Steering vs queueing from the prompt.
//
// A submitted prompt is admitted to the session inbox with a delivery: `queue` waits until the
// running turn would otherwise go idle, `steer` is promoted at the next safe step boundary of the
// running turn without interrupting the tool that is running. On an idle session both run right
// away, so the delivery is always sent and no client-side status check can race the server.
// Enter queues; the steer key (alt+return) or `/steer <text>` steers. Idle, the steer key submits
// like Enter, so it is always "send now"; shift+return always inserts a newline.
//
// A bare ESC CR is not a steer key press. Terminals without keyboard enhancements report
// alt+return that way, but so does every setup that maps Shift+Enter to ESC CR to get a newline
// out of a legacy terminal (the VS Code and Cursor `sendSequence` binding, Alacritty `chars`,
// iTerm2 "Send Escape Sequence", tmux). Those two cannot be told apart, and a newline that turns
// into a send loses a half-written prompt, so the legacy byte pair stays a newline. alt+return
// steers when the terminal reports it unambiguously: kitty `CSI 13;3u` or modifyOtherKeys
// `CSI 27;3;13~`.

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
 * The steer key layer is live whenever the prompt takes input, busy or idle: what the key does is
 * decided per press by `steerKeyIntent`, so a press that lands as the turn ends is never lost to
 * a layer that was disabled a moment earlier.
 */
export function steerKeyActive(input: { focused: boolean; disabled: boolean }) {
  return input.focused && !input.disabled
}

/** The parts of a key event that say how the terminal encoded it. */
export type KeyReport = { raw?: string; sequence?: string; source?: string }

/**
 * Whether a key event is the legacy ESC CR encoding, which a Shift+Enter mapped to ESC CR and a
 * legacy alt+return share. The steer key rejects it so it falls through to `input_newline`.
 */
export function legacyAltReturn(event: KeyReport | undefined) {
  if (!event || event.source === "kitty") return false
  return (event.raw ?? event.sequence) === "\x1b\r"
}

/** While the session works the steer key steers; idle, it submits exactly like Enter. */
export function steerKeyIntent(statusType: string | undefined): PromptIntent {
  return isBusy(statusType) ? "steer" : "submit"
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

export type TerminalEnv = { TERM_PROGRAM?: string; WT_SESSION?: string }

/**
 * Whether the terminal, out of the box, keeps alt+return to itself: macOS Terminal.app sends a
 * bare return until "Use Option as Meta key" is on, and Windows Terminal and WezTerm bind
 * alt+enter to fullscreen until that action is unbound. A terminal the person has fixed still gets
 * a conservative hint here; the key itself works regardless.
 */
export function altReturnUnreported(env: TerminalEnv) {
  return env.TERM_PROGRAM === "Apple_Terminal" || env.TERM_PROGRAM === "WezTerm" || env.WT_SESSION !== undefined
}

/**
 * Whether the busy hint should name `/steer` instead of the steer key. shift+return has no legacy
 * encoding at all. alt+return only steers when the terminal reports it unambiguously (see
 * `legacyAltReturn`), which a terminal without the kitty protocol may not do, and some hosts keep
 * the key for themselves (`altReturnUnreported`).
 */
export function steerKeyAmbiguous(steerKey: string, kittyKeyboard: boolean | undefined, env: TerminalEnv = {}) {
  if (/(alt|meta|option)\+(return|enter)/i.test(steerKey)) return kittyKeyboard === false || altReturnUnreported(env)
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
  env?: TerminalEnv
  queued?: boolean
}) {
  const parts: string[] = []
  const what = input.queued === true ? "steer queued" : "steer"
  if (input.submitKey) parts.push(`${input.submitKey} queue`)
  if (input.steerKey && !steerKeyAmbiguous(input.steerKey, input.kittyKeyboard, input.env))
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
