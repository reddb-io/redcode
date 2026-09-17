export * as GenerationTiming from "./generation-timing"

/**
 * How fast a model answered one provider step: measured where the stream is read, stored on the
 * assistant message, and read back the same way by every surface that shows it.
 *
 * Every duration comes from a monotonic clock (`performance.now()`), so a wall-clock jump during a
 * step cannot bend it. The epoch fields are derived from that clock too and exist for readers that
 * want a moment, not a duration.
 *
 * What counts as generation is narrow on purpose: the window runs from the first non-empty token
 * (text, reasoning, tool input, or a tool call whose input was not streamed) to the last one before
 * the step finished, both stamped when they arrived rather than when they were handled. Tool
 * execution, permission prompts, snapshots and hooks happen outside it, and so do the local work
 * before the request (`prepMs`) and the provider's wait (`ttftMs`).
 */
export interface Timing {
  /** Epoch ms: the HTTP attempt that produced this output went to the provider. */
  readonly requestStarted?: number
  /** Epoch ms: the first non-empty token of any kind, reasoning included. */
  readonly firstToken?: number
  /** Epoch ms: the first non-empty visible token, i.e. text or tool input. */
  readonly firstVisible?: number
  /** Epoch ms: the last token before the step finished. */
  readonly lastToken?: number
  /** Local work before the request: prompt assembly, tools, snapshots, auth, request preparation. */
  readonly prepMs?: number
  /** Time to first token: request start to the first non-empty token. */
  readonly ttftMs?: number
  /** Time to first visible token: request start to the first text or tool input. */
  readonly visibleMs?: number
  /** The generation window: first token to last token. */
  readonly genMs?: number
  /** The visible part of the window: first visible token to last token. */
  readonly visibleGenMs?: number
  /** Time inside the window spent waiting for the provider rather than handling what had arrived. */
  readonly idleMs?: number
  /** Visible output tokens the provider reported for the step. */
  readonly outputTokens?: number
  /** Reasoning tokens the provider reported for the step. */
  readonly reasoningTokens?: number
  /** Characters of reasoning that actually streamed; far fewer than the tokens means it was hidden. */
  readonly reasoningChars?: number
  /** The window was mostly local handling of output that had already arrived, not generation. */
  readonly burst?: boolean
  /** The step replayed events collected earlier (a compaction summary), so nothing was measured. */
  readonly replayed?: boolean
}

/** A rate over a shorter window than this is mostly noise. */
export const MIN_WINDOW_MS = 300
/** A rate over fewer tokens than this is mostly noise. */
export const MIN_TOKENS = 20
/** A window idle for less than this share of its length was local work on buffered output. */
export const MIN_IDLE_SHARE = 0.5
/** Characters per token when judging whether reasoning streamed; English prose averages about 4. */
export const CHARS_PER_TOKEN = 4
/** Streamed reasoning below this share of the reported reasoning was a summary, not the reasoning. */
export const MIN_REASONING_SHARE = 0.5

/**
 * Events whose handling waits on work outside the event loop: text-end runs plugin and display hooks,
 * a tool result may resize images, and a step's start and finish take snapshots. While they wait,
 * the provider reader keeps receiving, so their time is not a stall of the stream.
 */
const WAITS_OUTSIDE = new Set(["text-end", "tool-result", "tool-error", "step-start", "step-finish", "finish"])

/** The part of a stream event the recorder reads; both runtimes' `LLMEvent`s fit it. */
export interface StreamEvent {
  readonly type: string
  readonly id?: string
  readonly text?: string
}

/** Whether an event carries output: a non-empty delta, or a tool call. */
export function carriesToken(event: StreamEvent) {
  if (event.type === "tool-call") return true
  if (event.type === "text-delta" || event.type === "reasoning-delta" || event.type === "tool-input-delta")
    return Boolean(event.text)
  return false
}

/**
 * Arrival stamps for output that is handled later than it arrives. The side that reads the provider
 * pushes a stamp for every event that `carriesToken`, in order; the side that handles events takes
 * them in the same order. An empty queue falls back to the current time.
 */
export function arrivals(now: () => number = () => performance.now()) {
  const queue: number[] = []
  return {
    arrived() {
      queue.push(now())
    },
    take(event: StreamEvent) {
      if (!carriesToken(event)) return now()
      return queue.shift() ?? now()
    },
    clear() {
      queue.length = 0
    },
  }
}

/**
 * Records one step's timing as its stream is read. Call `attempt` at the start of every provider
 * attempt (and `discard` when one is thrown away), `request` right before each HTTP attempt,
 * `observe` with each event's arrival stamp, and `busy` with the interval spent handling it.
 */
export function recorder(input: {
  /** Epoch ms the assistant message was created: where the first attempt's local work starts. */
  readonly created: number
  readonly now?: () => number
  readonly epoch?: () => number
}) {
  const now = input.now ?? (() => performance.now())
  const anchor = now()
  const anchorEpoch = (input.epoch ?? Date.now)()
  const epochAt = (at: number) => Math.round(anchorEpoch + (at - anchor))
  let attempts = 0
  let attemptStart = anchor - Math.max(0, anchorEpoch - input.created)
  let firstRequest: number | undefined
  let request: number | undefined
  let first: number | undefined
  let visible: number | undefined
  let last: number | undefined
  let reasoningChars = 0
  let handling: Array<readonly [number, number]> = []
  const streamedInput = new Set<string>()

  const reset = () => {
    firstRequest = undefined
    request = undefined
    first = undefined
    visible = undefined
    last = undefined
    reasoningChars = 0
    handling = []
    streamedInput.clear()
  }

  return {
    attempt() {
      if (attempts > 0) attemptStart = now()
      attempts++
      reset()
    },
    discard: reset,
    /** A retried HTTP attempt calls this again: the answer is timed from the attempt that produced it. */
    request(at = now()) {
      firstRequest ??= at
      request = at
    },
    /** Returns true when this event carried the step's first token. */
    observe(event: StreamEvent, at = now()) {
      const kind = classify(event, streamedInput)
      if (!kind) return false
      if (event.type === "reasoning-delta") reasoningChars += event.text?.length ?? 0
      const isFirst = first === undefined
      if (isFirst) first = at
      if (visible === undefined && kind === "visible") visible = at
      last = Math.max(last ?? at, at)
      return isFirst
    },
    /**
     * Time spent handling an event. Handling that runs on the event loop holds up the provider reader
     * too, so output that arrives right after it was waiting, not being generated.
     */
    busy(event: StreamEvent, start: number, end: number) {
      if (end > start && !WAITS_OUTSIDE.has(event.type)) handling.push([start, end])
    },
    /** The step so far; token counts are known once the provider reports usage. */
    snapshot(usage?: { readonly output: number; readonly reasoning: number }): Timing | undefined {
      if (request === undefined && first === undefined) return undefined
      const genMs = first === undefined || last === undefined ? undefined : last - first
      const idleMs = genMs === undefined ? undefined : Math.max(0, genMs - overlap(handling, first!, last!))
      return compact({
        requestStarted: request === undefined ? undefined : epochAt(request),
        firstToken: first === undefined ? undefined : epochAt(first),
        firstVisible: visible === undefined ? undefined : epochAt(visible),
        lastToken: last === undefined ? undefined : epochAt(last),
        // Local work ends at the first call; a backoff before a resend is neither prep nor latency.
        prepMs: firstRequest === undefined ? undefined : duration(firstRequest - attemptStart),
        ttftMs: request === undefined || first === undefined ? undefined : duration(first - request),
        visibleMs: request === undefined || visible === undefined ? undefined : duration(visible - request),
        genMs: genMs === undefined ? undefined : duration(genMs),
        visibleGenMs: visible === undefined || last === undefined ? undefined : duration(last - visible),
        idleMs: idleMs === undefined ? undefined : duration(idleMs),
        outputTokens: usage === undefined ? undefined : count(usage.output),
        reasoningTokens: usage === undefined ? undefined : count(usage.reasoning),
        reasoningChars: first === undefined ? undefined : reasoningChars,
        burst:
          usage !== undefined && genMs !== undefined && (genMs === 0 || idleMs! < genMs * MIN_IDLE_SHARE)
            ? true
            : undefined,
      })
    },
  }
}

export type Recorder = ReturnType<typeof recorder>

function classify(event: StreamEvent, streamedInput: Set<string>): "reasoning" | "visible" | undefined {
  // Start events (`reasoning-start`, `text-start`, `tool-input-start`) are framing: OpenAI Responses
  // sends `reasoning-start` before any reasoning exists and Anthropic opens blocks ahead of content.
  if (event.type === "reasoning-delta") return event.text ? "reasoning" : undefined
  if (event.type === "text-delta") return event.text ? "visible" : undefined
  if (event.type === "tool-input-delta") {
    if (!event.text) return undefined
    if (event.id !== undefined) streamedInput.add(event.id)
    return "visible"
  }
  // A tool call whose input was never streamed is generated output arriving all at once.
  if (event.type === "tool-call") return event.id !== undefined && streamedInput.has(event.id) ? undefined : "visible"
  return undefined
}

function overlap(intervals: ReadonlyArray<readonly [number, number]>, from: number, to: number) {
  return intervals.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(end, to) - Math.max(start, from)), 0)
}

const duration = (ms: number) => Math.max(0, Math.round(ms))
const count = (value: number) => Math.max(0, Math.round(Number.isFinite(value) ? value : 0))

function compact(timing: Record<string, number | boolean | undefined>): Timing {
  return Object.fromEntries(Object.entries(timing).filter((entry) => entry[1] !== undefined)) as Timing
}

// ---------------------------------------------------------------------------------------------
// Reading it back
// ---------------------------------------------------------------------------------------------

/** The fields of a stored message the meter reads; the SDK's V1 message types fit it. */
export interface Message {
  readonly id: string
  readonly role: string
  readonly parentID?: string
  /** True on an assistant compaction summary; user messages carry an object here, which never matters. */
  readonly summary?: unknown
  readonly error?: unknown
  readonly time: { readonly created: number; readonly completed?: number }
  readonly timing?: Timing
}

export type Speed =
  /**
   * Tokens per second over the generation window. `hidden`: the provider counted reasoning that
   * never streamed (only a summary did, or nothing), so this rates the visible output alone over
   * the visible part of the window.
   */
  | { readonly type: "rate"; readonly value: number; readonly hidden?: boolean }
  /** Still generating: the token counts arrive with the step's usage. */
  | { readonly type: "pending" }
  /** Most of the window was local handling of output that had already arrived. */
  | { readonly type: "burst" }
  /** Too few tokens or too short a window for the number to mean anything. */
  | { readonly type: "short" }

export interface Step<M extends Message = Message> {
  readonly message: M
  /** Time to first token. */
  readonly latency?: number
  /** Time to first visible token. */
  readonly visible?: number
  /** Local work before the request. */
  readonly prep?: number
  readonly speed?: Speed
  /** The step is over (finished, failed, aborted or superseded): the values describe the past. */
  readonly stale: boolean
  readonly aborted: boolean
}

export interface Turn {
  /** Measured steps in the turn. Subagents run in their own sessions and are not counted. */
  readonly steps: number
  /** Steps whose rate went into `speed`; the others were bursts, too short, or unfinished. */
  readonly rated: number
  /** Time to first token of the turn's first step. */
  readonly latency?: number
  /** Σ tokens / Σ windows over the rated steps. */
  readonly speed?: Speed
}

export interface Meter<M extends Message = Message> {
  readonly step: Step<M>
  readonly turn: Turn
}

/**
 * The meter for a session's messages: the latest measured step and its turn.
 *
 * Compaction summaries and replayed steps are skipped, and so are messages written before timing
 * was recorded: their `time.first` counted tool runs and local work, so they show nothing rather
 * than a wrong number.
 */
export function meter<M extends Message>(messages: readonly M[]): Meter<M> | undefined {
  const index = messages.findLastIndex(measured)
  if (index < 0) return undefined
  const message = messages[index]!
  const superseded = messages.slice(index + 1).some((item) => item.role === "assistant" && !item.summary)
  const steps = messages.filter((item) => measured(item) && item.parentID === message.parentID)
  const rates = steps.map((item) => ({ item, rate: rateOf(item.timing) }))
  const rated = rates.filter((entry) => entry.rate !== undefined)
  return {
    step: step(message, superseded),
    turn: {
      steps: steps.length,
      rated: rated.length,
      latency: steps[0]?.timing?.ttftMs,
      speed:
        rated.length === 0
          ? steps.map((item) => speed(item.timing, item.time.completed !== undefined)).findLast(Boolean)
          : {
              type: "rate",
              value:
                rated.reduce((sum, entry) => sum + entry.rate!.tokens, 0) /
                (rated.reduce((sum, entry) => sum + entry.rate!.window, 0) / 1000),
              ...(rated.some((entry) => entry.rate!.hidden) ? { hidden: true } : {}),
            },
    },
  }
}

/** The rate a step's timing supports, if any. `done` says no usage will arrive any more. */
export function speed(timing: Timing | undefined, done = false): Speed | undefined {
  if (timing?.firstToken === undefined) return undefined
  if (timing.outputTokens === undefined) return done ? undefined : { type: "pending" }
  const hidden = reasoningHidden(timing)
  const tokens = hidden ? timing.outputTokens : timing.outputTokens + (timing.reasoningTokens ?? 0)
  const window = hidden ? timing.visibleGenMs : timing.genMs
  if (tokens < MIN_TOKENS) return { type: "short" }
  if (timing.burst) return { type: "burst" }
  if (window === undefined || window < MIN_WINDOW_MS) return { type: "short" }
  return { type: "rate", value: tokens / (window / 1000), ...(hidden ? { hidden: true } : {}) }
}

/**
 * The provider counted reasoning that did not stream: nothing did, or only a summary (redcode asks
 * OpenAI for reasoning summaries and Gemini for thought summaries). Rating those tokens over the
 * streamed window would count work done before it opened. Anthropic reports thinking inside output
 * tokens, not as reasoning tokens, so it is never judged hidden here; its summarized thinking
 * streams while the model thinks, so its window already spans that work.
 */
export function reasoningHidden(timing: Timing) {
  const reasoning = timing.reasoningTokens ?? 0
  if (reasoning <= 0) return false
  return (timing.reasoningChars ?? 0) < reasoning * CHARS_PER_TOKEN * MIN_REASONING_SHARE
}

export function formatLatency(ms: number, locale?: string) {
  if (ms < 1000) return unit(locale, "millisecond", 0).format(ms)
  return unit(locale, "second", ms < 10_000 ? 1 : 0).format(ms / 1000)
}

export function formatRate(tokensPerSecond: number, locale?: string) {
  const digits = tokensPerSecond < 10 ? 1 : 0
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(tokensPerSecond)} tk/s`
}

function rateOf(timing: Timing | undefined) {
  const result = speed(timing, true)
  if (result?.type !== "rate" || !timing) return undefined
  const hidden = result.hidden === true
  return {
    tokens: hidden ? timing.outputTokens! : timing.outputTokens! + (timing.reasoningTokens ?? 0),
    window: (hidden ? timing.visibleGenMs : timing.genMs)!,
    hidden,
  }
}

function measured(message: Message) {
  return (
    message.role === "assistant" &&
    !message.summary &&
    !message.timing?.replayed &&
    message.timing?.firstToken !== undefined
  )
}

function step<M extends Message>(message: M, superseded: boolean): Step<M> {
  const aborted = isAborted(message.error)
  const done = aborted || superseded || message.time.completed !== undefined
  return {
    message,
    latency: message.timing?.ttftMs,
    visible: message.timing?.visibleMs,
    prep: message.timing?.prepMs,
    speed: speed(message.timing, done),
    stale: done,
    aborted,
  }
}

function isAborted(error: unknown) {
  return typeof error === "object" && error !== null && "name" in error && error.name === "MessageAbortedError"
}

function unit(locale: string | undefined, name: "millisecond" | "second", digits: number) {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: name,
    unitDisplay: "narrow",
    maximumFractionDigits: digits,
  })
}
