import { isRecord } from "./record"

/** How long a blocking dialog waits for the local server before it re-checks the request. */
export const DIALOG_REQUEST_TIMEOUT = 10_000
/** A remote server sits behind a network, so it gets longer before it is called slow. */
export const REMOTE_DIALOG_REQUEST_TIMEOUT = 30_000
/** Same window the prompt uses for a repeated interrupt press. */
export const EXIT_PRESS_WINDOW = 5_000
/** How long a first Ctrl+C or Ctrl+D outside a dialog waits for the second press that exits. */
export const EXIT_CONFIRM_WINDOW = 2_000
/** The in-process worker transport the TUI uses when no external server was requested. */
const LOCAL_WORKER_URL = "http://opencode.internal"

export class DialogTimeoutError extends Error {
  constructor() {
    super("The server did not respond")
    this.name = "DialogTimeoutError"
  }
}

export function dialogTimeout(url: string) {
  return url === LOCAL_WORKER_URL ? DIALOG_REQUEST_TIMEOUT : REMOTE_DIALOG_REQUEST_TIMEOUT
}

/**
 * Run a dialog's reply or reject with a deadline. The signal aborts the request, and the race settles
 * the promise even when a transport ignores the signal, so a busy or hung server cannot keep a
 * blocking dialog's keys waiting forever.
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

const NOT_FOUND = new Set(["QuestionNotFoundError", "PermissionNotFoundError"])

function tagged(value: unknown) {
  return isRecord(value) && (NOT_FOUND.has(String(value._tag)) || NOT_FOUND.has(String(value.name)))
}

/**
 * Only the server saying the request does not exist makes a dialog stale; other errors may be retried.
 * With throwOnError the SDK wraps the body in an Error whose cause carries `{ body, status }`.
 */
export function isNotFound(error: unknown) {
  const cause = error instanceof Error && isRecord(error.cause) ? error.cause : undefined
  if (cause) return cause.status === 404 || tagged(cause.body)
  return tagged(error)
}

/**
 * - `gone`: the server no longer has the request, so the dialog is stale.
 * - `slow-gone`: timed out, and the request is no longer pending. The answer may still have been applied.
 * - `slow-pending`: timed out, and the request is still pending. Keep waiting.
 * - `unreachable`: timed out, and the server did not answer the check either.
 * - `failed`: any other error. The request is still there to retry.
 */
export type DialogFailure = "gone" | "slow-gone" | "slow-pending" | "unreachable" | "failed"

export async function classifyDialogFailure(
  error: unknown,
  stillPending: () => Promise<boolean>,
): Promise<DialogFailure> {
  if (isNotFound(error)) return "gone"
  if (!(error instanceof DialogTimeoutError)) return "failed"
  const pending = await stillPending().catch(() => undefined)
  if (pending === undefined) return "unreachable"
  return pending ? "slow-pending" : "slow-gone"
}

/**
 * Blocking dialogs rebind the exit key to dismiss themselves. A second press on the same dialog, for
 * the same request and stage, inside the window still leaves the app, whatever the first press is
 * waiting on. A press on a different request or stage starts over, so dismissing one dialog never
 * arms an exit on the next.
 */
export function createExitPresses(window = EXIT_PRESS_WINDOW) {
  let last: { key: string; at: number } | undefined
  return {
    press(key: string, now = Date.now()) {
      const diff = last?.key === key ? now - last.at : -1
      const repeated = 0 <= diff && diff <= window
      last = repeated ? undefined : { key, at: now }
      return repeated
    },
    reset() {
      last = undefined
    },
  }
}

/**
 * The exit keys that are easy to hit by accident, bare ctrl+c and ctrl+d, named for the hint.
 * Anything else that runs `app.exit` (a leader chord, `/exit`, the palette) was meant and exits.
 */
export function accidentalExitKey(
  event: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean } | undefined,
) {
  if (!event?.ctrl || event.meta || event.shift) return
  if (event.name === "c" || event.name === "d") return `ctrl+${event.name}`
}

export type ExitKeyAction = "exit" | "interrupt" | "confirm"

/**
 * What `app.exit` does for the key that ran it. An accidental exit key never exits on its first
 * press: while the session works it interrupts the turn, otherwise it asks for the same key again
 * within `EXIT_CONFIRM_WINDOW`. `repeated` is whether this press is that second one.
 */
export function exitKeyAction(input: { key: string | undefined; busy: boolean; repeated: boolean }): ExitKeyAction {
  if (!input.key) return "exit"
  if (input.busy) return "interrupt"
  return input.repeated ? "exit" : "confirm"
}
