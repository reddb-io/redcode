export * as ContextUsage from "./context-usage.js"

/**
 * How full a session's context window is, read from its projected messages the same way in every surface. The
 * reading is the last assistant step that reported usage after the latest completed compaction and before the
 * revert boundary: a compaction starts a new window, and reverted steps are no longer in it.
 */

/** Token usage one assistant step reports. */
export interface Tokens {
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cache: { readonly read: number; readonly write: number }
}

/** The fields of a session message the reading uses. */
export interface Message {
  readonly id: string
  readonly type: string
  /** A compaction's state; only a completed compaction starts a new window. */
  readonly status?: string
}

/** The model a step ran on. */
export interface ModelRef {
  readonly providerID: string
  readonly id: string
}

/** An assistant step that reported usage. */
export type Measured<M extends Message> = Extract<M, { readonly type: "assistant" }> & {
  readonly tokens: Tokens
  readonly model: ModelRef
}

export interface Usage<M extends Message> {
  /** The step the reading comes from. */
  readonly message: Measured<M>
  /** Every token of that step: input, output, reasoning and both cache counts. */
  readonly tokens: number
  /** The context window the percentage is of, when the model's window is known. */
  readonly limit?: number
  /** `tokens` as a rounded percentage of `limit`; over 100 when the step overflowed the believed window. */
  readonly percent?: number
}

/**
 * The last assistant step with usage inside the current window, or nothing when no step reported usage since the
 * latest completed compaction. `boundary` is the revert boundary's message id: the reading stops before it, and a
 * boundary that is not in the list gives no reading.
 */
export function lastMeasured<M extends Message>(messages: ReadonlyArray<M>, boundary?: string) {
  const boundaryIndex = boundary ? messages.findIndex((message) => message.id === boundary) : -1
  if (boundary && boundaryIndex === -1) return undefined
  const end = boundaryIndex === -1 ? messages.length : boundaryIndex
  const compactionIndex = messages.findLastIndex(
    (message, index) => message.type === "compaction" && message.status === "completed" && index < end,
  )
  return messages.findLast(
    (message, index): message is Measured<M> =>
      message.type === "assistant" && "tokens" in message && !!message.tokens && index > compactionIndex && index < end,
  )
}

/**
 * The current window's usage. `limit` looks up the context window of the step's model; zero or nothing means the
 * window is unknown, which leaves `limit` and `percent` out. A step that reported no tokens gives no reading.
 */
export function read<M extends Message>(
  messages: ReadonlyArray<M>,
  limit: (model: ModelRef) => number | undefined,
  boundary?: string,
): Usage<M> | undefined {
  const message = lastMeasured(messages, boundary)
  if (!message) return
  const tokens =
    message.tokens.input +
    message.tokens.output +
    message.tokens.reasoning +
    message.tokens.cache.read +
    message.tokens.cache.write
  if (tokens <= 0) return
  // The model entry carries no provenance, so whether its window was reported, cataloged or guessed is not known here.
  const window = limit(message.model) || undefined
  return {
    message,
    tokens,
    limit: window,
    percent: window === undefined ? undefined : Math.round((tokens / window) * 100),
  }
}

/** The reading is over the window the model is believed to have. */
export function over(usage: Pick<Usage<Message>, "percent">) {
  return usage.percent !== undefined && usage.percent > 100
}

/**
 * `14.1K / 200K (7%)` once the window is known, `14.1K` until then. `number` formats a token count, so each surface
 * keeps its own number style and locale.
 */
export function format(usage: Pick<Usage<Message>, "tokens" | "limit" | "percent">, number: (value: number) => string) {
  const value = usage.limit === undefined ? number(usage.tokens) : `${number(usage.tokens)} / ${number(usage.limit)}`
  return usage.percent === undefined ? value : `${value} (${usage.percent}%)`
}
