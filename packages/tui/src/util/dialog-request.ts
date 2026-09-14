/** How long a blocking dialog waits for the server before it gives up on a reply or reject. */
export const DIALOG_REQUEST_TIMEOUT = 10_000
/** Same window the prompt uses for a repeated interrupt press. */
export const EXIT_PRESS_WINDOW = 5_000

export class DialogTimeoutError extends Error {
  constructor() {
    super("The server did not respond")
    this.name = "DialogTimeoutError"
  }
}

/**
 * Run a dialog's reply or reject with a deadline. The signal aborts the request, and the race settles
 * the promise even when a transport ignores the signal, so a busy or hung server cannot keep a
 * blocking dialog on screen.
 */
export function dialogRequest<T>(run: (signal: AbortSignal) => Promise<T>, timeout = DIALOG_REQUEST_TIMEOUT) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new DialogTimeoutError())
    }, timeout)
  })
  return Promise.race([run(controller.signal), expired]).finally(() => clearTimeout(timer))
}

let lastExitPress = 0

/**
 * Blocking dialogs rebind the exit key to dismiss themselves. A second press inside the window must
 * still leave the app, whatever the first press is waiting on. Shared across dialogs so a press that
 * closed one stage counts toward the next.
 */
export function repeatedExitPress(now = Date.now()) {
  const repeated = lastExitPress > 0 && now - lastExitPress <= EXIT_PRESS_WINDOW
  lastExitPress = repeated ? 0 : now
  return repeated
}
