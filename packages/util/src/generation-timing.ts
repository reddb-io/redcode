export * as GenerationTiming from "./generation-timing.js"

/**
 * How fast a model answered one step, read back from the projected assistant message. Nothing is
 * recorded for it: `time.created` is the request dispatch, `time.first` the first text, reasoning
 * or tool input block, `time.streamed` the end of the response body, and the tokens come with the
 * step's usage. Tool runs happen outside that window, so they never count as generation.
 */

/** A rate over a shorter window than this is mostly noise. */
export const MIN_WINDOW_MS = 300
/** A rate over fewer tokens than this is mostly noise. */
export const MIN_TOKENS = 20
/** Characters per token when judging whether reasoning streamed; English prose averages about 4. */
export const CHARS_PER_TOKEN = 4
/** Streamed reasoning below this share of the reported reasoning was a summary, not the reasoning. */
export const MIN_REASONING_SHARE = 0.5

/** The fields of an assistant message the meter reads, as millisecond timestamps. */
export interface Message {
  readonly time: {
    readonly created: number
    readonly first?: number
    readonly streamed?: number
    readonly completed?: number
  }
  readonly tokens?: { readonly output: number; readonly reasoning: number }
  readonly content: ReadonlyArray<{
    readonly type: string
    readonly text?: string
    readonly time?: { readonly completed?: number }
  }>
}

export interface Step {
  /** Request dispatch to the first streamed block. */
  readonly latency: number
  /** Tokens per second over the generation window, when there is a real rate to show. */
  readonly speed?: number
  /** The provider reported reasoning that did not stream, so the rate covers the visible output alone. */
  readonly hidden: boolean
  /** The step is over: the values describe the past. */
  readonly done: boolean
}

/** The step's timing, or nothing when no output arrived (or it was recorded before timing existed). */
export function step(message: Message): Step | undefined {
  if (message.time.first === undefined) return undefined
  const hidden = reasoningHidden(message)
  return {
    latency: Math.max(0, message.time.first - message.time.created),
    speed: speed(message, hidden),
    hidden,
    done: message.time.completed !== undefined,
  }
}

/**
 * The provider counted reasoning that did not stream: nothing did, or only a summary (OpenAI and
 * Gemini summarize). Rating those tokens over the streamed window would count work done before it
 * opened. Anthropic reports thinking inside output tokens, so it is never judged hidden here.
 */
export function reasoningHidden(message: Message) {
  const reasoning = message.tokens?.reasoning ?? 0
  if (reasoning <= 0) return false
  const streamed = message.content
    .filter((part) => part.type === "reasoning")
    .reduce((sum, part) => sum + (part.text?.length ?? 0), 0)
  return streamed < reasoning * CHARS_PER_TOKEN * MIN_REASONING_SHARE
}

function speed(message: Message, hidden: boolean) {
  const first = message.time.first
  const end = message.time.streamed
  if (first === undefined || end === undefined || message.tokens === undefined) return undefined
  const tokens = hidden ? message.tokens.output : message.tokens.output + message.tokens.reasoning
  // With hidden reasoning the visible output starts once the last reasoning summary closed.
  const start = hidden
    ? Math.min(
        end,
        Math.max(
          first,
          ...message.content.flatMap((part) =>
            part.type === "reasoning" && part.time?.completed !== undefined ? [part.time.completed] : [],
          ),
        ),
      )
    : first
  const window = end - start
  if (tokens < MIN_TOKENS || window < MIN_WINDOW_MS) return undefined
  return tokens / (window / 1000)
}

export function formatLatency(ms: number, locale?: string) {
  if (ms < 1000) return unit(locale, "millisecond", 0).format(ms)
  return unit(locale, "second", ms < 10_000 ? 1 : 0).format(ms / 1000)
}

export function formatRate(tokensPerSecond: number, locale?: string) {
  const digits = tokensPerSecond < 10 ? 1 : 0
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(tokensPerSecond)} tk/s`
}

function unit(locale: string | undefined, name: "millisecond" | "second", digits: number) {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: name,
    unitDisplay: "narrow",
    maximumFractionDigits: digits,
  })
}
