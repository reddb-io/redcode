// Steering vs queueing from the prompt.
//
// A submitted prompt is admitted to the session inbox with a delivery: `steer` is promoted at the
// next safe step boundary of the running turn, `queue` waits until the running turn would
// otherwise go idle. While the agent works, Enter steers and the queue key (alt+return) or
// `/queue <text>` queues. Idle, both keys just send. With nothing typed, Enter steers the most
// recently queued prompt instead of sending nothing.
//
// A bare ESC CR is not a queue key press by default. Terminals without keyboard enhancements
// report alt+return that way, but so does every setup that maps Shift+Enter to ESC CR to get a
// newline out of a legacy terminal (VS Code and Cursor `sendSequence`, Alacritty `chars`, iTerm2
// "Send Escape Sequence", tmux). The bytes cannot tell them apart, and a newline that turns into a
// send loses a half-written prompt, so ESC CR stays a newline until something rules the Shift+Enter
// mapping out: the terminal has already reported Shift+Enter in a form of its own (`CSI 13;2u`,
// `CSI 27;2;13~`), or the config keeps alt+return off `input.newline`. alt+return always queues
// when the terminal reports it unambiguously: kitty `CSI 13;3u` or modifyOtherKeys `CSI 27;3;13~`.

import type { SessionInbox } from "@opencode/schema/session-inbox"

export type PromptKey = "enter" | "queue"

/** Only the queue key (or `/queue`) queues, and only while the agent works; everything else steers. */
export function promptDelivery(key: PromptKey, busy: boolean): SessionInbox.Delivery {
  return key === "queue" && busy ? "queue" : "steer"
}

/**
 * The queued prompt a send with nothing typed acts on: a steer moves the most recently queued
 * prompt ahead, while a queue has nothing to queue. `undefined` when nothing applies.
 */
export function emptyPromptTarget<T>(delivery: SessionInbox.Delivery, queued: readonly T[]) {
  return delivery === "steer" ? queued.at(-1) : undefined
}

export const QUEUE_SLASH = "queue"

/**
 * `/queue <text>` queues from every terminal, whatever it reports for alt+return. Returns the text
 * to queue (possibly empty) and the length of the removed prefix, or `undefined` when the input is
 * not that command.
 */
export function parseQueueCommand(input: string) {
  const prefix = /^\/queue(?:[ \t]+|\n|$)/.exec(input)?.[0]
  if (prefix === undefined) return undefined
  return { text: input.slice(prefix.length), prefix: prefix.length }
}

/** Moves mention offsets back by the width of a prefix removed from the start of the text. */
export function shiftMentions<T extends { mention?: { start: number; end: number } }>(
  items: T[] | undefined,
  by: number,
): T[] | undefined {
  return items?.map((item) => {
    if (!item.mention) return item
    const start = Math.max(0, item.mention.start - by)
    return { ...item, mention: { ...item.mention, start, end: Math.max(start, item.mention.end - by) } }
  })
}

/** The parts of a key event that say how the terminal encoded it. */
export type KeyReport = { raw?: string; sequence?: string; source?: string; name?: string; shift?: boolean }

/** Whether a key event is the legacy ESC CR encoding that a mapped Shift+Enter and alt+return share. */
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
    return (
      "name" in key &&
      (key.name === "return" || key.name === "enter") &&
      "meta" in key &&
      key.meta === true &&
      !("ctrl" in key && key.ctrl === true) &&
      !("shift" in key && key.shift === true)
    )
  })
}

export type EscCrContext = {
  /** The terminal has already sent Shift+Enter as `CSI 13;2u` or `CSI 27;2;13~` this run. */
  shiftReturnReported: boolean
  /** `input.newline` lists alt+return, so ESC CR has a newline to fall back to. */
  newlineOnAltReturn: boolean
}

/** Whether a bare ESC CR can only be alt+return here (see the note at the top of the file). */
export function escCrIsAltReturn(context: EscCrContext) {
  return context.shiftReturnReported || !context.newlineOnAltReturn
}

/** Whether the queue or steer key lets this press fall through to `input.newline`. */
export function promptKeyRejects(event: KeyReport | undefined, context: EscCrContext) {
  return legacyAltReturn(event) && !escCrIsAltReturn(context)
}

export type TerminalEnv = { TERM_PROGRAM?: string; WT_SESSION?: string }

/**
 * Whether the terminal, out of the box, keeps alt+return to itself: macOS Terminal.app sends a
 * bare return until "Use Option as Meta key" is on, and Windows Terminal and WezTerm bind
 * alt+enter to fullscreen until that action is unbound.
 */
export function altReturnUnreported(env: TerminalEnv) {
  return env.TERM_PROGRAM === "Apple_Terminal" || env.TERM_PROGRAM === "WezTerm" || env.WT_SESSION !== undefined
}

/**
 * Whether the busy hint should name `/queue` instead of the queue key: alt+return only queues when
 * the terminal reports it unambiguously or a bare ESC CR is known to be alt+return, and some hosts
 * keep the key for themselves.
 */
export function queueKeyAmbiguous(input: {
  queueKey: string
  kittyKeyboard?: boolean
  env?: TerminalEnv
  escCrQueues?: boolean
}) {
  if (!/(alt|meta|option)\+(return|enter)/i.test(input.queueKey)) return false
  if (altReturnUnreported(input.env ?? {})) return true
  return input.kittyKeyboard === false && input.escCrQueues !== true
}

/**
 * The hint shown next to the prompt while the agent works, e.g. `enter steer · alt+enter queue`.
 * With `queued`, Enter on an empty prompt steers the prompt already waiting in the queue and says so.
 */
export function busyHint(input: {
  submitKey?: string
  queueKey?: string
  kittyKeyboard?: boolean
  env?: TerminalEnv
  queued?: boolean
  /** A bare ESC CR queues here (`escCrIsAltReturn`), so the legacy alt+return works too. */
  escCrQueues?: boolean
}) {
  const label = (key: string) => key.replace(/\breturn\b/g, "enter")
  const queueKey = input.queueKey ?? ""
  const queueKeyWorks =
    queueKey !== "" &&
    !queueKeyAmbiguous({
      queueKey,
      kittyKeyboard: input.kittyKeyboard,
      env: input.env,
      escCrQueues: input.escCrQueues,
    })
  return [
    ...(input.submitKey ? [`${label(input.submitKey)} ${input.queued === true ? "steer queued" : "steer"}`] : []),
    queueKeyWorks ? `${label(queueKey)} queue` : `/${QUEUE_SLASH} queue`,
  ].join(" · ")
}
