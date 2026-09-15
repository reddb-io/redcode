// Steering vs queueing from the prompt.
//
// While a session is working, a submitted prompt is admitted to the session inbox with a delivery:
// `queue` waits until the running turn would otherwise go idle, `steer` is promoted at the next
// safe step boundary of the running turn without interrupting the tool that is running. Enter
// queues (the default), the steer keybind (shift+return) or `/steer <text>` steers. On an idle
// session both are a plain submit and no delivery is sent.

export type PromptIntent = "submit" | "steer"
export type Delivery = "steer" | "queue"

/** Session status type as the TUI stores it (`idle`, `busy`, `retry`, ...). */
export function isBusy(statusType: string | undefined) {
  return statusType !== undefined && statusType !== "idle"
}

/** The delivery a prompt is sent with; `undefined` on an idle session (a normal submit). */
export function promptDelivery(intent: PromptIntent, statusType: string | undefined): Delivery | undefined {
  if (!isBusy(statusType)) return undefined
  return intent === "steer" ? "steer" : "queue"
}

export const STEER_SLASH = "steer"

/**
 * `/steer <text>` is the steer fallback that works in every terminal. Returns the text to steer
 * with (possibly empty), or `undefined` when the input is not a steer command.
 */
export function parseSteerCommand(input: string): string | undefined {
  const match = /^\/steer(?:[ \t]+|\n|$)/.exec(input)
  if (!match) return undefined
  return input.slice(match[0].length)
}

/** Whether a terminal without keyboard enhancements would report the steer key as a plain return. */
export function steerKeyAmbiguous(steerKey: string, kittyKeyboard: boolean | undefined) {
  if (kittyKeyboard !== false) return false
  return /shift\+(return|enter)/i.test(steerKey)
}

/** The hint shown next to the prompt while the session works. */
export function busyHint(input: { submitKey: string; steerKey: string; kittyKeyboard?: boolean }) {
  const parts: string[] = []
  if (input.submitKey) parts.push(`${input.submitKey} queue`)
  if (input.steerKey && !steerKeyAmbiguous(input.steerKey, input.kittyKeyboard)) parts.push(`${input.steerKey} steer`)
  else parts.push(`/${STEER_SLASH} steer`)
  return parts.join(" · ")
}

export type PendingBadge = { label: string; tone: "steer" | "queue" }

/** Badge for a user message that is admitted but not yet promoted into the running turn. */
export function pendingBadge(delivery: Delivery | undefined): PendingBadge {
  if (delivery === "steer") return { label: "STEER", tone: "steer" }
  return { label: "QUEUED", tone: "queue" }
}

/**
 * The delivery the transcript remembers for an admitted prompt. Only prompts admitted while the
 * session was working are remembered: an idle submit is admitted as a steer too, but nothing was
 * steered.
 */
export function rememberedDelivery(delivery: Delivery, statusType: string | undefined): Delivery | undefined {
  return isBusy(statusType) ? delivery : undefined
}
