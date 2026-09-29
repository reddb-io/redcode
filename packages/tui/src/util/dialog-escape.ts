export * as DialogEscape from "./dialog-escape"

import { onCleanup } from "solid-js"

/** A second dismissal within this window closes a dialog locally, whatever the server says. */
export const WINDOW_MS = 5_000
export const LOCAL_REPLY_MS = 10_000
export const REMOTE_REPLY_MS = 30_000

export const SLOW_NOTICE =
  "The server has not confirmed this answer yet; checking whether the request still exists. Dismiss twice to close the dialog."
export const ESCAPED_NOTICE =
  "Closed the dialog without an answer from the server. Interrupt the session if its turn is still waiting."

/** Whether the server lives on another machine, so its replies get more time before they count as slow. */
export function remote(url: string | undefined) {
  if (!url) return false
  const host = URL.parse(url)?.hostname
  if (host === undefined) return false
  return !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)
}

export const replyDelay = (url: string | undefined) => (remote(url) ? REMOTE_REPLY_MS : LOCAL_REPLY_MS)

/** Counts dismissals: true on a second one within {@link WINDOW_MS} of the previous one. */
export function createPresses(window = WINDOW_MS, now = Date.now) {
  let last: number | undefined
  return () => {
    const time = now()
    const escaped = last !== undefined && time - last <= window
    last = escaped ? undefined : time
    return escaped
  }
}

/**
 * Watches a dialog's replies. A reply the server has not settled after `delay` runs `slow`, which tells
 * the person and re-reads the pending requests, so a request the server no longer has closes the dialog.
 */
export function createReplyWatch(input: { delay: () => number; slow: () => void }) {
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  return <T>(request: Promise<T>) => {
    clearTimeout(timer)
    timer = setTimeout(input.slow, input.delay())
    return request.finally(() => clearTimeout(timer))
  }
}
