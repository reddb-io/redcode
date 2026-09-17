export * as GenerationTiming from "./generation-timing"

import { Schema } from "effect"
import { optional } from "./schema"

const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const Count = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * How fast one provider step answered, as both runtimes record it. Durations come from a monotonic
 * clock and exclude tool runs, permission waits, snapshots and hooks; `GenerationTiming` in core
 * holds the recorder and the rules for reading it back.
 */
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  /** Epoch ms: the HTTP attempt that produced this output went to the provider. */
  requestStarted: Milliseconds.pipe(optional),
  /** Epoch ms: the first non-empty token of any kind arrived, reasoning included. */
  firstToken: Milliseconds.pipe(optional),
  /** Epoch ms: the first non-empty text or tool input arrived. */
  firstVisible: Milliseconds.pipe(optional),
  /** Epoch ms: the last token before the step finished arrived. */
  lastToken: Milliseconds.pipe(optional),
  /** Local work before the request of the attempt that produced this output. */
  prepMs: Milliseconds.pipe(optional),
  /** Request start to the first token. */
  ttftMs: Milliseconds.pipe(optional),
  /** Request start to the first visible token. */
  visibleMs: Milliseconds.pipe(optional),
  /** First token to last token. */
  genMs: Milliseconds.pipe(optional),
  /** First visible token to last token. */
  visibleGenMs: Milliseconds.pipe(optional),
  /** Time inside the window spent waiting for the provider rather than handling output. */
  idleMs: Milliseconds.pipe(optional),
  /** Visible output tokens reported for the step. */
  outputTokens: Count.pipe(optional),
  /** Reasoning tokens reported for the step. */
  reasoningTokens: Count.pipe(optional),
  /** Characters of reasoning that streamed. */
  reasoningChars: Count.pipe(optional),
  /** The window was mostly local handling of output that had already arrived, not generation. */
  burst: Schema.Boolean.pipe(optional),
  /** The step replayed events collected earlier, so nothing was measured. */
  replayed: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "GenerationTiming" })
