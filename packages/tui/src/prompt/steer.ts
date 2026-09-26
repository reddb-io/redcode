// Steering vs queueing from the prompt.
//
// A submitted prompt is admitted to the session inbox with a delivery: `steer` is promoted at the
// next safe step boundary of the running turn without interrupting the tool that is running,
// `queue` waits until the running turn would otherwise go idle. On an idle session both run right
// away, so the delivery is always sent and no client-side status check can race the server.
// Enter steers; the queue key (alt+return) or `/queue <text>` queues. Idle, the queue key submits
// like Enter, so it is always "send"; shift+return always inserts a newline. `/steer <text>` and an
// explicitly configured `input_steer` key still steer, like Enter.
//
// A bare ESC CR is not a queue key press by default. Terminals without keyboard enhancements
// report alt+return that way, but so does every setup that maps Shift+Enter to ESC CR to get a
// newline out of a legacy terminal (the VS Code and Cursor `sendSequence` binding, Alacritty
// `chars`, iTerm2 "Send Escape Sequence", tmux). Those two cannot be told apart from the bytes,
// and a newline that turns into a send loses a half-written prompt, so the legacy byte pair stays
// a newline until something rules the Shift+Enter mapping out: the terminal has already reported
// Shift+Enter in a form of its own (`CSI 13;2u`, `CSI 27;2;13~`), or the config keeps alt+return
// off `input_newline`. alt+return always queues when the terminal reports it unambiguously: kitty
// `CSI 13;3u` or modifyOtherKeys `CSI 27;3;13~`. A multiplexer that forwards legacy bytes (zellij
// without the kitty protocol, tmux) sends ESC CR for Alt+Enter, so this is the common case there.

export type PromptIntent = "submit" | "steer" | "queue"
export type Delivery = "steer" | "queue"

/** Session status type as the TUI stores it (`idle`, `busy`, `retry`, ...). */
export function isBusy(statusType: string | undefined) {
  return statusType !== undefined && statusType !== "idle"
}

/** The delivery a prompt is sent with: only the queue key and `/queue` queue, everything else steers. */
export function promptDelivery(intent: PromptIntent): Delivery {
  return intent === "queue" ? "queue" : "steer"
}

/**
 * The queue and steer key layer is live whenever the prompt takes input, busy or idle: what a key
 * does is decided per press by `queueKeyIntent` / `steerKeyIntent`, so a press that lands as the
 * turn ends is never lost to a layer that was disabled a moment earlier.
 */
export function promptKeyActive(input: { focused: boolean; disabled: boolean }) {
  return input.focused && !input.disabled
}

/** The parts of a key event that say how the terminal encoded it. */
export type KeyReport = { raw?: string; sequence?: string; source?: string; name?: string; shift?: boolean }

/**
 * Whether a key event is the legacy ESC CR encoding, which a Shift+Enter mapped to ESC CR and a
 * legacy alt+return share. The queue key rejects it so it falls through to `input_newline`.
 */
export function legacyAltReturn(event: KeyReport | undefined) {
  if (!event || event.source === "kitty") return false
  return (event.raw ?? event.sequence) === "\x1b\r"
}

/**
 * Whether a key event is Shift+Enter in a form no alt+return shares (kitty `CSI 13;2u`,
 * modifyOtherKeys `CSI 27;2;13~`). Once a terminal has sent one, its Shift+Enter is not mapped to
 * ESC CR, so a later ESC CR can only be alt+return.
 */
export function distinctShiftReturn(event: KeyReport | undefined) {
  if (!event || event.name !== "return" || event.shift !== true) return false
  return (event.raw ?? event.sequence ?? "").startsWith("\x1b[")
}

/** Whether a set of bindings (as the keybind lookup returns them) includes alt+return. */
export function bindsAltReturn(bindings: readonly { key: unknown }[]) {
  return bindings.some((binding) => {
    const key = binding.key
    if (typeof key === "string")
      return key.split(",").some((part) => /^(alt|meta|option)\+(return|enter)$/i.test(part.trim()))
    if (typeof key !== "object" || key === null) return false
    const stroke = key as { name?: unknown; meta?: unknown; ctrl?: unknown; shift?: unknown }
    return (
      (stroke.name === "return" || stroke.name === "enter") && stroke.meta === true && !stroke.ctrl && !stroke.shift
    )
  })
}

export type EscCrContext = {
  /** The terminal has already sent Shift+Enter as `CSI 13;2u` or `CSI 27;2;13~` this run. */
  shiftReturnReported: boolean
  /** `input_newline` lists alt+return, so ESC CR has a newline to fall back to. */
  newlineOnAltReturn: boolean
}

/** Whether a bare ESC CR can only be alt+return here (see the note at the top of the file). */
export function escCrIsAltReturn(context: EscCrContext) {
  return context.shiftReturnReported || !context.newlineOnAltReturn
}

/** Whether the queue or steer key lets this press fall through to `input_newline`. */
export function promptKeyRejects(event: KeyReport | undefined, context: EscCrContext) {
  return legacyAltReturn(event) && !escCrIsAltReturn(context)
}

/** While the session works the queue key queues; idle, it submits exactly like Enter. */
export function queueKeyIntent(statusType: string | undefined): PromptIntent {
  return isBusy(statusType) ? "queue" : "submit"
}

/** An explicitly configured steer key steers while the session works; idle, it submits like Enter. */
export function steerKeyIntent(statusType: string | undefined): PromptIntent {
  return isBusy(statusType) ? "steer" : "submit"
}

export const STEER_SLASH = "steer"
export const QUEUE_SLASH = "queue"

export type DeliverySlash = typeof STEER_SLASH | typeof QUEUE_SLASH

/**
 * `/queue <text>` and `/steer <text>` pick the delivery from every terminal, whatever it reports
 * for alt+return. Returns the text to send (possibly empty), or `undefined` when the input is not
 * that command.
 */
export function parseSlashCommand(name: DeliverySlash, input: string): string | undefined {
  const prefix = slashPrefixLength(name, input)
  return prefix === undefined ? undefined : input.slice(prefix)
}

function slashPrefixLength(name: DeliverySlash, input: string) {
  const match = new RegExp(`^/${name}(?:[ \\t]+|\\n|$)`).exec(input)
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
 * Strips `/queue` or `/steer` from the prompt text and moves the parts' text offsets (file and
 * symbol parts keep them under `source.text`, agent parts directly under `source`) by the removed
 * prefix, so a message restored into the prompt still lines its mentions up with the text.
 */
export function stripSlashCommand<P extends SourcedPart>(
  name: DeliverySlash,
  text: string,
  parts: readonly P[],
): { text: string; parts: P[] } | undefined {
  const prefix = slashPrefixLength(name, text)
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
 * Whether the busy hint should name `/queue` instead of the queue key. shift+return has no legacy
 * encoding at all. alt+return only queues when the terminal reports it unambiguously (see
 * `legacyAltReturn`), which a terminal without the kitty protocol may not do, and some hosts keep
 * the key for themselves (`altReturnUnreported`).
 */
export function queueKeyAmbiguous(
  queueKey: string,
  kittyKeyboard: boolean | undefined,
  env: TerminalEnv = {},
  escCrQueues = false,
) {
  if (/(alt|meta|option)\+(return|enter)/i.test(queueKey)) {
    if (altReturnUnreported(env)) return true
    return kittyKeyboard === false && !escCrQueues
  }
  if (kittyKeyboard !== false) return false
  return /shift\+(return|enter)/i.test(queueKey)
}

/**
 * The hint shown next to the prompt while the session works. With `queued`, Enter on an empty
 * prompt steers the prompt already waiting in the queue rather than sending nothing, and says so.
 */
export function busyHint(input: {
  submitKey: string
  queueKey: string
  kittyKeyboard?: boolean
  env?: TerminalEnv
  queued?: boolean
  /** A bare ESC CR queues here (`escCrIsAltReturn`), so the legacy alt+return works too. */
  escCrQueues?: boolean
}) {
  const parts: string[] = []
  if (input.submitKey) parts.push(`${input.submitKey} ${input.queued === true ? "steer queued" : "steer"}`)
  if (input.queueKey && !queueKeyAmbiguous(input.queueKey, input.kittyKeyboard, input.env, input.escCrQueues))
    parts.push(`${input.queueKey} queue`)
  else parts.push(`/${QUEUE_SLASH} queue`)
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
 * "steer queued" (Enter on an empty prompt while busy) acts on. `undefined` when nothing is waiting.
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
