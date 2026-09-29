/** How long a first bare Ctrl+C or Ctrl+D waits for the second press that exits. */
export const EXIT_CONFIRM_WINDOW = 2_000

/**
 * The exit keys that are easy to hit by accident, bare ctrl+c and ctrl+d, named for the hint.
 * Anything else that runs `app.exit` (a leader chord, `/exit`, the palette) was meant and exits.
 */
export function accidentalExitKey(event: { name: string; ctrl: boolean; meta: boolean; shift: boolean } | undefined) {
  if (!event?.ctrl || event.meta || event.shift) return
  if (event.name === "c" || event.name === "d") return `ctrl+${event.name}`
}

/**
 * Remembers the first press of an accidental exit key. `press` is true only for the same key pressed
 * again within the window; that confirming press starts the next sequence over.
 */
export function createExitConfirm(window = EXIT_CONFIRM_WINDOW, now: () => number = Date.now) {
  let last: { key: string; at: number } | undefined
  return {
    press(key: string) {
      const at = now()
      const confirmed = last !== undefined && last.key === key && at - last.at <= window
      last = confirmed ? undefined : { key, at }
      return confirmed
    },
  }
}
