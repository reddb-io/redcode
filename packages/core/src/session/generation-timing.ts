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
 * the step finished. Tool execution, permission prompts, snapshots and hooks all happen outside it,
 * and so do the local work before the request (`prepMs`) and the provider's wait (`ttftMs`).
 */
export interface Timing {
  /** Epoch ms: the request of the attempt that produced this output went to the provider. */
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
  /** Output plus reasoning tokens the provider reported for the step: the rate's numerator. */
  readonly tokens?: number
  /** Every token arrived in at most two deliveries: the window measures local work, not generation. */
  readonly burst?: boolean
  /** The step replayed events collected earlier (a compaction summary), so nothing was measured. */
  readonly replayed?: boolean
}

/** A rate over a shorter window than this is mostly noise. */
export const MIN_WINDOW_MS = 300
/** A rate over fewer tokens than this is mostly noise. */
export const MIN_TOKENS = 20
/** At most this many separate deliveries is a burst, not a stream. */
export const MAX_BURST_ARRIVALS = 2
/**
 * An event that was waited for at least this long after the previous one was handled arrived on
 * its own. Events handed over back to back were already buffered and belong to the same delivery.
 */
export const ARRIVAL_GAP_MS = 4

/** The part of a stream event the recorder reads; both runtimes' `LLMEvent`s fit it. */
export interface StreamEvent {
  readonly type: string
  readonly id?: string
  readonly text?: string
}

/**
 * Records one step's timing as its stream is read. Call `attempt` at the start of every provider
 * attempt (and `discard` when one is thrown away), `request` right before the provider call,
 * `observe` when an event is pulled and `handled` once it has been processed.
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
  let request: number | undefined
  let first: number | undefined
  let visible: number | undefined
  let last: number | undefined
  let arrivals = 0
  let lastHandled: number | undefined
  let waited = true
  const streamedInput = new Set<string>()

  const reset = () => {
    request = undefined
    first = undefined
    visible = undefined
    last = undefined
    arrivals = 0
    lastHandled = undefined
    waited = true
    streamedInput.clear()
  }

  return {
    attempt() {
      if (attempts > 0) attemptStart = now()
      attempts++
      reset()
    },
    discard: reset,
    request() {
      request = now()
    },
    /** Returns true when this event carried the step's first token. */
    observe(event: StreamEvent) {
      const at = now()
      if (lastHandled === undefined || at - lastHandled >= ARRIVAL_GAP_MS) waited = true
      const kind = classify(event, streamedInput)
      if (!kind) return false
      const isFirst = first === undefined
      if (isFirst) first = at
      if (waited) arrivals++
      waited = false
      if (visible === undefined && kind === "visible") visible = at
      last = at
      return isFirst
    },
    handled() {
      lastHandled = now()
    },
    /** The step so far; `tokens` is known once the provider reports usage. */
    snapshot(tokens?: number): Timing | undefined {
      if (request === undefined && first === undefined) return undefined
      return compact({
        requestStarted: request === undefined ? undefined : epochAt(request),
        firstToken: first === undefined ? undefined : epochAt(first),
        firstVisible: visible === undefined ? undefined : epochAt(visible),
        lastToken: last === undefined ? undefined : epochAt(last),
        prepMs: request === undefined ? undefined : duration(request - attemptStart),
        ttftMs: request === undefined || first === undefined ? undefined : duration(first - request),
        visibleMs: request === undefined || visible === undefined ? undefined : duration(visible - request),
        genMs: first === undefined || last === undefined ? undefined : duration(last - first),
        tokens: tokens === undefined ? undefined : Math.max(0, Math.round(tokens)),
        burst: tokens !== undefined && first !== undefined && arrivals <= MAX_BURST_ARRIVALS ? true : undefined,
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

const duration = (ms: number) => Math.max(0, Math.round(ms))

function compact(timing: Record<string, number | boolean | undefined>): Timing {
  return Object.fromEntries(Object.entries(timing).filter((entry) => entry[1] !== undefined)) as Timing
}

// ---------------------------------------------------------------------------------------------
// Reading it back
// ---------------------------------------------------------------------------------------------

/** The fields of a stored message the meter reads; the SDK's message types fit it. */
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
  /** Output plus reasoning tokens per second over the generation window. */
  | { readonly type: "rate"; readonly value: number }
  /** Still generating: the token count arrives with the step's usage. */
  | { readonly type: "pending" }
  /** Delivered in one or two bursts, so there is no stream to measure. */
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
  /** Measured steps in the turn. */
  readonly steps: number
  /** Time to first token of the turn's first step. */
  readonly latency?: number
  /** Σ tokens / Σ generation windows over the turn's steps with a meaningful rate. */
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
  return {
    step: step(message, superseded),
    turn: {
      steps: steps.length,
      latency: steps[0]?.timing?.ttftMs,
      speed: turnSpeed(steps),
    },
  }
}

/** The rate a step's timing supports, if any. `done` says no usage will arrive any more. */
export function speed(timing: Timing | undefined, done = false): Speed | undefined {
  if (timing?.firstToken === undefined) return undefined
  if (timing.tokens === undefined) return done ? undefined : { type: "pending" }
  if (timing.tokens < MIN_TOKENS) return { type: "short" }
  if (timing.burst) return { type: "burst" }
  if (timing.genMs === undefined || timing.genMs < MIN_WINDOW_MS) return { type: "short" }
  return { type: "rate", value: timing.tokens / (timing.genMs / 1000) }
}

export function formatLatency(ms: number, locale?: string) {
  if (ms < 1000) return unit(locale, "millisecond", 0).format(ms)
  return unit(locale, "second", ms < 10_000 ? 1 : 0).format(ms / 1000)
}

export function formatRate(tokensPerSecond: number, locale?: string) {
  const digits = tokensPerSecond < 10 ? 1 : 0
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(tokensPerSecond)} tk/s`
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

function turnSpeed(steps: readonly Message[]): Speed | undefined {
  const speeds = steps.map((item) => speed(item.timing, item.time.completed !== undefined))
  const rated = steps.filter((_, index) => speeds[index]?.type === "rate")
  if (rated.length === 0) return speeds.findLast((item) => item !== undefined)
  const tokens = rated.reduce((sum, item) => sum + (item.timing?.tokens ?? 0), 0)
  const window = rated.reduce((sum, item) => sum + (item.timing?.genMs ?? 0), 0)
  return { type: "rate", value: tokens / (window / 1000) }
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
