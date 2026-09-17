export * as GenerationTiming from "./generation-timing"

import { Schema } from "effect"
import { optional } from "./schema"

const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * How fast one provider step answered, as both runtimes record it. Durations come from a monotonic
 * clock and exclude tool runs, permission waits, snapshots and hooks; `GenerationTiming` in core
 * holds the recorder and the rules for reading it back.
 */
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  /** Epoch ms: the request of the attempt that produced this output went to the provider. */
  requestStarted: Milliseconds.pipe(optional),
  /** Epoch ms: the first non-empty token of any kind, reasoning included. */
  firstToken: Milliseconds.pipe(optional),
  /** Epoch ms: the first non-empty text or tool input. */
  firstVisible: Milliseconds.pipe(optional),
  /** Epoch ms: the last token before the step finished. */
  lastToken: Milliseconds.pipe(optional),
  /** Local work before the request of the attempt that produced this output. */
  prepMs: Milliseconds.pipe(optional),
  /** Request start to the first token. */
  ttftMs: Milliseconds.pipe(optional),
  /** Request start to the first visible token. */
  visibleMs: Milliseconds.pipe(optional),
  /** First token to last token. */
  genMs: Milliseconds.pipe(optional),
  /** Output plus reasoning tokens reported for the step. */
  tokens: Milliseconds.pipe(optional),
  /** All tokens arrived in at most two deliveries, so the window does not measure generation. */
  burst: Schema.Boolean.pipe(optional),
  /** The step replayed events collected earlier, so nothing was measured. */
  replayed: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "GenerationTiming" })
