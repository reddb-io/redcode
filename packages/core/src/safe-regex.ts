/**
 * Regular expressions written by a model or a person, matched off the main thread. A backtracking pattern
 * such as `(a+)+$` can run for longer than any monitor lives, and a match cannot be interrupted on the thread
 * it runs on. Here it runs in a worker that is terminated after a hard timeout: the runtime keeps serving while
 * a pattern is stuck, the caller gets a timeout instead of a frozen process, and the next match gets a new worker.
 *
 * Each monitor holds its own matcher, so one monitor's stuck pattern never queues another monitor's matches.
 */
export * as SafeRegex from "./safe-regex"

import { Worker } from "node:worker_threads"

/** The longest one match may take. */
export const MATCH_TIMEOUT_MS = 200
/** How long a fresh worker may take to start; not counted against a match. */
const START_TIMEOUT_MS = 10_000
/** An idle worker is stopped after this long, so a monitor that polls rarely does not hold a thread. */
const IDLE_MS = 15_000
/** The words every timeout carries, so callers can count them. */
export const TIMEOUT_ERROR = "regex timed out"

export type Outcome = { readonly match: string | undefined } | { readonly timedOut: true } | { readonly error: string }

export interface Matcher {
  /** Matches `source` against `text`, one match at a time on this matcher, each bounded by `timeoutMs`. */
  exec(source: string, text: string, timeoutMs?: number): Promise<Outcome>
  /** Stops this matcher's worker; a later match starts a new one. */
  close(): void
}

const SOURCE = `
const { parentPort } = require("node:worker_threads")
parentPort.on("message", ({ id, source, text }) => {
  try {
    const hit = new RegExp(source).exec(text)
    parentPort.postMessage({ id, match: hit ? hit[0] : null })
  } catch (error) {
    parentPort.postMessage({ id, error: String((error && error.message) || error) })
  }
})
parentPort.postMessage({ ready: true })
`

type Running = { worker: Worker; ready: Promise<void> }

/** A matcher with its own worker and its own queue. */
export function create(): Matcher {
  let running: Running | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let sequence = 0
  let idle: ReturnType<typeof setTimeout> | undefined

  const spawn = (): Running => {
    // Evaluated source rather than a worker file, so a bundled or compiled build carries it without extra assets.
    const worker = new Worker(SOURCE, { eval: true })
    worker.unref()
    const current: Running = {
      worker,
      ready: new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("the regex worker did not start")), START_TIMEOUT_MS)
        worker.once("message", () => {
          clearTimeout(timer)
          resolve()
        })
        worker.once("error", (error) => {
          clearTimeout(timer)
          reject(error)
        })
      }),
    }
    current.ready.catch(() => {})
    const forget = () => {
      if (running === current) running = undefined
    }
    worker.on("error", forget)
    worker.on("exit", forget)
    return current
  }

  const stop = (current: Running | undefined) => {
    if (!current) return
    if (running === current) running = undefined
    void current.worker.terminate().catch(() => {})
  }

  const once = async (source: string, text: string, timeoutMs: number): Promise<Outcome> => {
    if (idle) clearTimeout(idle)
    const current = (running ??= spawn())
    try {
      await current.ready
    } catch (error) {
      stop(current)
      return { error: error instanceof Error ? error.message : String(error) }
    }
    const id = ++sequence
    const outcome = await new Promise<Outcome>((resolve) => {
      const listen = (message: { id?: number; match?: string | null; error?: string }) => {
        if (message.id !== id) return
        clearTimeout(timer)
        current.worker.off("message", listen)
        resolve(message.error !== undefined ? { error: message.error } : { match: message.match ?? undefined })
      }
      const timer = setTimeout(() => {
        current.worker.off("message", listen)
        stop(current)
        resolve({ timedOut: true })
      }, timeoutMs)
      current.worker.on("message", listen)
      current.worker.postMessage({ id, source, text })
    })
    idle = setTimeout(() => stop(running), IDLE_MS)
    idle.unref?.()
    return outcome
  }

  return {
    exec(source, text, timeoutMs = MATCH_TIMEOUT_MS) {
      const result = queue.then(() => once(source, text, timeoutMs))
      queue = result.catch(() => undefined)
      return result
    },
    close() {
      if (idle) clearTimeout(idle)
      stop(running)
    },
  }
}

const shared = create()

/** Matches on a shared matcher; a monitor should hold its own through `create`. */
export function exec(source: string, text: string, timeoutMs = MATCH_TIMEOUT_MS): Promise<Outcome> {
  return shared.exec(source, text, timeoutMs)
}
