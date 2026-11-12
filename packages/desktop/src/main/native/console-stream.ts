import type { Writable } from "node:stream"

const watched = new WeakSet<Writable>()

/** A closed parent pipe may report its error after console.write has returned. */
export function watchConsoleStreams(streams: readonly Writable[], disable: () => void) {
  for (const stream of streams) {
    if (watched.has(stream)) continue
    watched.add(stream)
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE") {
        disable()
        return
      }
      // Preserve the default unhandled-error behavior when no other listener handles it.
      if (stream.listenerCount("error") === 1) throw error
    })
  }
}
