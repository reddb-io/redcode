import {
  classifyRequest,
  createRequestQueueState,
  isRequestInflight,
  REQUEST_QUEUE_LIMIT,
  REQUEST_QUEUE_SLOW_LIMIT,
  REQUEST_STALL_MS,
  selectInflightCount,
  selectQueueDisposed,
  selectQueuedCount,
  transitionRequestQueue,
  type RequestQueueEffect,
  type RequestQueueEvent,
  type RequestStallSnapshot,
} from "./request-queue-machine"

const requestHeadersTimeoutMs = 60_000
const setupRequestHeadersTimeoutMs = 10 * 60_000

export function createRequestQueue(input: {
  fetch: typeof globalThis.fetch
  limit?: number
  slowLimit?: number
  stallMs?: number
  headersTimeoutMs?: number
  setupHeadersTimeoutMs?: number
  log?: (message: string, data: RequestStallSnapshot) => void
  now?: () => number
}) {
  const config = {
    limit: input.limit ?? REQUEST_QUEUE_LIMIT,
    slowLimit: input.slowLimit ?? REQUEST_QUEUE_SLOW_LIMIT,
    stallMs: input.stallMs ?? REQUEST_STALL_MS,
  }
  const headersTimeoutMs = input.headersTimeoutMs ?? requestHeadersTimeoutMs
  const setupHeadersTimeoutMs = input.setupHeadersTimeoutMs ?? setupRequestHeadersTimeoutMs
  const base = input.fetch
  const now = input.now ?? Date.now
  const log = input.log ?? ((message, data) => console.warn(`[server-request-queue] ${message}`, data))
  let queue = createRequestQueueState()
  let watcher: ReturnType<typeof setTimeout> | undefined
  const waiters = new Map<number, { grant: () => void; cancel: () => void }>()
  const controllers = new Map<number, AbortController>()

  const run = (effect: RequestQueueEffect) => {
    if (effect.type === "request.start") return waiters.get(effect.id)?.grant()
    if (effect.type === "request.cancel")
      return effect.ids.forEach((id) => {
        waiters.get(id)?.cancel()
        controllers.get(id)?.abort(aborted())
      })
    if (effect.type === "log.stall") return log("server thrashing detected", effect.data)

    clearTimeout(watcher)
    watcher =
      effect.type === "watcher.start"
        ? setTimeout(() => dispatch({ type: "watch.due", now: now() }), effect.delayMs)
        : undefined
  }

  const dispatch = (event: RequestQueueEvent) => {
    const result = transitionRequestQueue(queue, event, config)
    queue = result.state
    result.effects.forEach(run)
  }

  const waitForSlot = (id: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const leave = () => {
        signal.removeEventListener("abort", abort)
        waiters.delete(id)
      }
      const abort = () => {
        leave()
        dispatch({ type: "request.aborted", id, now: now() })
        reject(reason(signal))
      }

      signal.addEventListener("abort", abort, { once: true })
      waiters.set(id, {
        grant: () => {
          leave()
          resolve()
        },
        cancel: () => {
          leave()
          reject(aborted())
        },
      })
    })

  const fetch: typeof globalThis.fetch = Object.assign(
    async (resource: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(resource, init)
      const kind = classifyRequest(request.method, new URL(request.url))

      if (kind.bypass) return base(request)
      if (request.signal.aborted || selectQueueDisposed(queue)) throw reason(request.signal)
      const id = queue.nextId
      dispatch({
        type: "request.arrived",
        method: request.method,
        url: request.url,
        slow: kind.slow,
        priority: kind.priority,
        now: now(),
      })

      if (!isRequestInflight(queue, id)) await waitForSlot(id, request.signal)
      if (request.signal.aborted || selectQueueDisposed(queue)) {
        dispatch({ type: "request.aborted", id, now: now() })
        throw reason(request.signal)
      }

      const controller = new AbortController()
      controllers.set(id, controller)
      const abort = () => controller.abort(request.signal.reason)
      request.signal.addEventListener("abort", abort, { once: true })
      const timer = setTimeout(
        () => controller.abort(new DOMException("Timed out waiting for the server to respond", "TimeoutError")),
        kind.setup ? setupHeadersTimeoutMs : headersTimeoutMs,
      )

      return base(new Request(request, { signal: controller.signal })).finally(() => {
        clearTimeout(timer)
        request.signal.removeEventListener("abort", abort)
        controllers.delete(id)
        dispatch({ type: "request.settled", id, now: now() })
      })
    },
    { preconnect: () => {} },
  )

  return {
    fetch,
    inflight: () => selectInflightCount(queue),
    queued: () => selectQueuedCount(queue),
    dispose: () => dispatch({ type: "disposed" }),
  }
}

function aborted() {
  return new DOMException("The operation was aborted.", "AbortError")
}

function reason(signal: AbortSignal) {
  return signal.aborted ? (signal.reason ?? aborted()) : aborted()
}
