import { Effect, Stream } from "effect"
import { fromWritable } from "@effect/platform-node/NodeSink"
import type { Writable } from "node:stream"

/** Capture process output without keeping a second copy of its contents in memory. */
export function writeOutput<E>(
  source: Stream.Stream<Uint8Array, E>,
  output: Writable,
  onChunk: (chunk: Uint8Array) => void,
) {
  return source.pipe(
    Stream.tap((chunk) => Effect.sync(() => onChunk(chunk))),
    Stream.run(fromWritable({ evaluate: () => output, onError: (error) => error })),
    Effect.ensuring(Effect.sync(() => output.destroy())),
  )
}
