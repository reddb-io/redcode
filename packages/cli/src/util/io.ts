import { text } from "node:stream/consumers"
import type { Readable } from "node:stream"

// A non-TTY stdin is not always a finite pipe: launched from a wrapper, an editor task or a
// console shim, the child can inherit a pipe nobody ever closes, and reading it to EOF then
// blocks forever. Callers that already have a prompt wait briefly for piped data to start.
const STDIN_DEADLINE_MS = 2000

export function readStdin() {
  return text(process.stdin)
}

/**
 * Reads the stream to EOF when its first chunk (or EOF) arrives within `ms`; otherwise stops
 * waiting and returns undefined. Once data starts flowing it is read in full, so a slow but real
 * pipe is never cut short.
 */
export async function readStdinWithin(ms = STDIN_DEADLINE_MS, stream: Readable = process.stdin) {
  const chunks = stream[Symbol.asyncIterator]()
  const next = chunks.next()
  const deadline = Promise.withResolvers<undefined>()
  const timer = setTimeout(() => deadline.resolve(undefined), ms)
  const first = await Promise.race([next, deadline.promise])
  clearTimeout(timer)
  if (!first) {
    // Destroying the stream settles the pending read; its outcome no longer matters.
    next.catch(() => undefined)
    stream.destroy()
    return undefined
  }
  if (first.done) return ""
  const rest = await Array.fromAsync({ [Symbol.asyncIterator]: () => chunks })
  return Buffer.concat([first.value, ...rest].map((chunk) => Buffer.from(chunk))).toString("utf8")
}
