import type { Design } from "@reddb-io/redcode-schema/design"

/**
 * Follows the server's conversation feed over Server-Sent Events. Both hosts serialize this
 * function into the standalone review page, so keep it self-contained: no imports beyond types,
 * no closures over module state. Reconnects from the last durable sequence with a 1 s to 10 s
 * backoff and stops when the signal aborts. A client-side rejection (any 4xx other than 408 and
 * 429) will not change by retrying, so it reports the feed as unavailable and stops.
 */
export function designFeed(
  url: string,
  request: (url: string, init?: RequestInit) => Promise<Response>,
  signal: AbortSignal,
  onEvent: (event: Design.FeedEvent) => void,
  onUnavailable: () => void,
) {
  const state = { after: 0, delay: 1000, buffer: "" }
  const parse = (data: string): Design.FeedEvent | undefined => {
    try {
      const event = JSON.parse(data)
      if (!event || typeof event !== "object" || typeof event.type !== "string") return undefined
      return event
    } catch {
      return undefined
    }
  }
  const deliver = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n")
    const event = data ? parse(data) : undefined
    if (!event) return
    state.delay = 1000
    if (typeof event.seq === "number" && event.seq > state.after) state.after = event.seq
    onEvent(event)
  }
  const read = async () => {
    const response = await request(`${url}${url.includes("?") ? "&" : "?"}after=${state.after}`, {
      signal,
      headers: { accept: "text/event-stream" },
    })
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429)
      return false
    if (!response.ok || !response.body) throw new Error(String(response.status))
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    state.buffer = ""
    while (!signal.aborted) {
      const chunk = await reader.read()
      if (chunk.done) return true
      state.buffer += decoder.decode(chunk.value, { stream: true })
      const blocks = state.buffer.split(/\r?\n\r?\n/)
      state.buffer = blocks.pop() ?? ""
      blocks.forEach(deliver)
    }
    return true
  }
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
    })
  const loop = async () => {
    while (!signal.aborted) {
      // A dropped stream is routine (server restart, sleep); the next attempt resumes from `after`.
      const retry = await read().catch(() => true)
      if (signal.aborted) return
      if (!retry) {
        onUnavailable()
        return
      }
      await wait(state.delay)
      state.delay = Math.min(state.delay * 2, 10000)
    }
  }
  void loop()
}
