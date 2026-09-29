/**
 * The paste key (ctrl+v, ctrl+shift+v) makes the prompt read the clipboard itself. A terminal that
 * both forwards the key and performs its own bracketed paste would deliver the same clipboard
 * twice, so a paste from one source is dropped when the other source delivered the same content
 * within a short window. Two pastes from the same source are never merged: pressing the key twice
 * pastes twice.
 */
export const PASTE_DEDUPE_WINDOW_MS = 500

export type PasteDedupe = ReturnType<typeof createPasteDedupe>

// Clipboard tools and terminals disagree on line endings and a trailing newline.
function normalize(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
}

export function createPasteDedupe(now: () => number = Date.now, windowMs = PASTE_DEDUPE_WINDOW_MS) {
  let key: { at: number; text: string } | undefined
  let keyStartedAt = Number.NEGATIVE_INFINITY
  let terminal: { at: number; text: string } | undefined

  return {
    /** Marks the paste key pressed, before the clipboard read; returns the start time. */
    keyStarted() {
      keyStartedAt = now()
      return keyStartedAt
    },
    /** Whether clipboard text read after `startedAt` should be inserted. */
    acceptKeyText(startedAt: number, text: string) {
      const value = normalize(text)
      if (terminal && terminal.text === value && terminal.at >= startedAt - windowMs) return false
      key = { at: now(), text: value }
      return true
    },
    /** Whether a non-empty bracketed paste should be inserted. */
    acceptTerminalText(text: string) {
      const value = normalize(text)
      if (key && key.text === value && now() - key.at <= windowMs) return false
      terminal = { at: now(), text: value }
      return true
    },
    /**
     * Whether an empty bracketed paste (a terminal reporting an image-only clipboard) should read
     * the clipboard. It is dropped while a key paste started within the window is reading or has
     * pasted.
     */
    acceptTerminalEmpty() {
      return now() - keyStartedAt > windowMs
    },
  }
}
