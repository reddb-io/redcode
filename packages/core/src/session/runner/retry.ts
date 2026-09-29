export * as SessionRunnerRetry from "./retry.js"

import { AIError, isRetryable } from "@opencode/ai"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { SessionError } from "@opencode/schema/session-error"
import { Clock, Duration, Effect, Pull, Schedule, Stream } from "effect"
import { Bus } from "../../bus.js"
import type { PluginHooks } from "../../plugin/hooks.js"
import { SessionEvent } from "../event.js"
import { SessionMessage } from "../message.js"
import { SessionSchema } from "../schema.js"

export { isRetryable }

interface Input {
  readonly cause: AIError
  readonly error: SessionError.Error
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly hook: (event: PluginHooks.Domains["session"]["retry"]) => Effect.Effect<void>
  readonly retry: boolean
}

export interface Decision {
  readonly retry: true
  readonly attempt: number
  readonly delay: number
}

/** No retry; `error`, when set, replaces the provider's own error as what the person reads. */
export interface Stop {
  readonly retry: false
  readonly error?: SessionError.Error
}

/** A provider that will not serve the model before `until`: a quota or rate limit that resets too far off to wait for. */
export interface Exhausted {
  readonly until: number
  /** Whether the failure names a quota or usage limit rather than a plain wait. */
  readonly quota: boolean
}

/** Bound provider-requested delays so a hostile or buggy retry-after cannot stall a session for hours. */
const RETRY_AFTER_MAX = Duration.toMillis("15 minutes")

/**
 * The longest reset a retry waits out. A quota or rate limit that frees up later ends the turn at once,
 * so the person can switch models instead of watching a countdown on one they cannot use.
 */
export const RESET_WAIT_MAX = Duration.toMillis("2 minutes")

// Routers in the 9Router family name the instant an account frees up and why it is unavailable.
const ROUTER_RETRY_AT = "x-9router-retry-at"
const ROUTER_REASON = "x-9router-reason"
// An explicit reset in the error text, as routers write it: "quota exhausted until 2026-09-25T18:00:00Z".
const UNTIL_PATTERN = /\buntil\s+(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)/i
const QUOTA_PATTERN = /quota|usage limit|insufficient[_\s]credits|credit balance/i

const retryAfter = (input: Input) => {
  if (input.cause.reason._tag === "RateLimit" || input.cause.reason._tag === "ProviderInternal")
    return input.cause.reason.retryAfterMs === undefined
      ? undefined
      : Math.min(input.cause.reason.retryAfterMs, RETRY_AFTER_MAX)
  return undefined
}

// Exponential from 2s capped at 10s per gap, for 10 retries: 2, 4, 8, then 10 × 7, about 84s of
// waiting when every attempt fails (67–101s with jitter). `min` takes the faster schedule, so the
// cap applies per gap; `max` with `recurs` bounds the count.
const schedule = Schedule.max([
  Schedule.min([Schedule.exponential("2 seconds"), Schedule.spaced("10 seconds")]),
  Schedule.recurs(10),
]).pipe(
  Schedule.jittered,
  Schedule.setInputType<Input>(),
  Schedule.modifyDelay(({ input, duration: delay }) => {
    const minimum = retryAfter(input)
    const duration = minimum === undefined ? delay : Duration.max(delay, Duration.millis(minimum))
    return Effect.succeed(Duration.millis(Math.ceil(Duration.toMillis(duration))))
  }),
)

export const policy = (sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const step = yield* Schedule.toStep(schedule)
    let attempt = 1
    return (input: Input) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const far = exhausted(input.cause, now)
        const stop: Stop = far
          ? {
              retry: false,
              error: {
                ...input.error,
                type: far.quota ? "provider.quota" : input.error.type,
                message: exhaustedMessage(`${input.model.providerID} · ${input.model.id}`, far, now),
              },
            }
          : { retry: false }
        const next = yield* step(now, input).pipe(Pull.catchDone(() => Effect.succeed(undefined)))
        if (!next) return stop
        const [, duration] = next
        attempt++
        const delay = Math.ceil(Duration.toMillis(duration))
        const event: PluginHooks.Domains["session"]["retry"] = {
          sessionID,
          agent: input.agent,
          model: input.model,
          error: input.error,
          attempt,
          // A far reset is proposed as a stop; a hook may still choose to wait it out.
          decision: input.retry && !far ? { retry: true, delay } : { retry: false },
        }
        yield* input.hook(event)
        if (!event.decision.retry) return stop
        const normalized =
          Number.isFinite(event.decision.delay) && event.decision.delay >= 0 ? Math.ceil(event.decision.delay) : delay
        return { retry: true as const, attempt, delay: normalized }
      })
  })

export const make = (bus: Bus.Interface, sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    let decide = yield* policy(sessionID)
    const wait = (input: {
      readonly decision: Decision
      readonly assistantMessageID: SessionMessage.ID
      readonly error: SessionError.Error
    }) =>
      Effect.gen(function* () {
        const scheduled = yield* Clock.currentTimeMillis
        yield* bus.publish(SessionEvent.RetryScheduled, {
          sessionID,
          assistantMessageID: input.assistantMessageID,
          attempt: input.decision.attempt,
          at: scheduled + input.decision.delay,
          error: input.error,
        })
        const remaining = Math.max(0, scheduled + input.decision.delay - (yield* Clock.currentTimeMillis))
        // Selecting another model ends the wait: the caller reloads the Session and sends to the new model,
        // which starts with fresh attempts rather than the exhausted model's remaining ones.
        const switched = yield* Effect.raceFirst(
          Effect.sleep(Duration.millis(remaining)).pipe(Effect.as(false)),
          bus.subscribe(SessionEvent.ModelSelected).pipe(
            Stream.filter((event) => event.data.sessionID === sessionID),
            Stream.runHead,
            Effect.as(true),
          ),
        )
        if (switched) decide = yield* policy(sessionID)
      })
    return { decide: (input: Input) => decide(input), wait }
  })

/** When the failure's reset is further off than RESET_WAIT_MAX: the instant it frees up. */
export const exhausted = (cause: AIError, now: number): Exhausted | undefined => {
  const reason = cause.reason
  const wait = requested(reason, now) ?? untilIn([reason.message, reason.body], now)
  if (wait === undefined || wait <= RESET_WAIT_MAX) return undefined
  return {
    until: now + wait,
    quota:
      reason._tag === "QuotaExceeded" ||
      reason.http?.status === 402 ||
      reason.http?.headers[ROUTER_REASON] === "quota_exhausted" ||
      [reason.message, reason.body].some((text) => text !== undefined && QUOTA_PATTERN.test(text)),
  }
}

/** What the person reads when a model is exhausted: which one, until when, and what to do about it. */
export const exhaustedMessage = (model: string, info: Exhausted, now: number) =>
  `${model} ${info.quota ? "quota exhausted" : "unavailable"} until ${clock(info.until, now)}; switch model with /model or wait`

/** A reset instant in local time: the time alone today, with the date on another day. */
export const clock = (at: number, now: number) => {
  const date = new Date(at)
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  if (date.toDateString() === new Date(now).toDateString()) return time
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`
}

/** How long the provider asked to wait, uncapped: the typed retry-after, then retry-after-ms, a router's retry-at, retry-after. */
function requested(reason: AIError["reason"], now: number) {
  const typed = "retryAfterMs" in reason ? reason.retryAfterMs : undefined
  if (typed !== undefined) return typed
  const headers = reason.http?.headers ?? {}
  const millis = Number.parseFloat(headers["retry-after-ms"] ?? "")
  if (!Number.isNaN(millis)) return millis
  // Retry-After rounds the router's instant up a second, so the instant wins.
  const retryAt = Date.parse(headers[ROUTER_RETRY_AT] ?? "") - now
  if (retryAt > 0) return Math.ceil(retryAt)
  const retryAfter = headers["retry-after"] ?? ""
  const seconds = Number.parseFloat(retryAfter)
  if (!Number.isNaN(seconds)) return Math.ceil(seconds * 1000)
  const date = Date.parse(retryAfter) - now
  return date > 0 ? Math.ceil(date) : undefined
}

function untilIn(texts: ReadonlyArray<string | undefined>, now: number) {
  const waits = texts.flatMap((text) => {
    const match = text === undefined ? null : UNTIL_PATTERN.exec(text)
    const at = match ? Date.parse(match[1].replace(" ", "T")) - now : Number.NaN
    // NaN compares false, so an unparsable or past reset drops out here.
    return at > 0 ? [at] : []
  })
  return waits.length ? Math.max(...waits) : undefined
}
