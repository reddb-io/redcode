import { describe, expect } from "bun:test"
import { Effect, Fiber } from "effect"
import { AIError, HttpContext, QuotaExceededError, RateLimitError } from "@opencode/ai"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"
import { SessionTable } from "@opencode/core/session/sql"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Project } from "@opencode/schema/project"
import { AbsolutePath } from "@opencode/schema/schema"
import { SessionEvent } from "@opencode/schema/session-event"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)
const id = SessionID.make("ses_retry_policy")
const now = Date.parse("2026-09-25T12:00:00Z")
const model = Model.Ref.parse("red-router/gpt-6-sol")
const rateLimited = (message: string, retryAfterMs?: number) =>
  new AIError({ reason: new RateLimitError({ message, retryAfterMs }) })
const input = (cause: AIError) => ({
  cause,
  error: { type: "provider.rate-limit", message: cause.reason.message },
  agent: Agent.ID.make("build"),
  model,
  hook: () => Effect.void,
  retry: true,
})

const seed = Effect.fn(function* () {
  const database = yield* Database.Service
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/retry"), sandboxes: [] })
    .run()
  yield* database.db
    .insert(SessionTable)
    .values({
      id,
      project_id: Project.ID.global,
      directory: AbsolutePath.make("/retry"),
      slug: "retry",
      version: "test",
    })
    .run()
})

describe("SessionRunnerRetry.exhausted", () => {
  it.effect("stops on a reset too far off to wait for and keeps a short one", () =>
    Effect.sync(() => {
      expect(SessionRunnerRetry.exhausted(rateLimited("usage limit reached", 15 * 60_000), now)).toEqual({
        until: now + 15 * 60_000,
        quota: true,
      })
      expect(SessionRunnerRetry.exhausted(rateLimited("Too many requests", 60_000), now)).toBeUndefined()
      expect(SessionRunnerRetry.exhausted(rateLimited("Too many requests"), now)).toBeUndefined()
      expect(SessionRunnerRetry.exhausted(rateLimited("Too many requests", 10 * 60_000), now)).toEqual({
        until: now + 10 * 60_000,
        quota: false,
      })
    }),
  )

  it.effect("reads a reset the error text names", () =>
    Effect.sync(() => {
      const cause = rateLimited(
        "The usage limit has been reached (router: quota exhausted until 2026-09-26T08:00:00.000Z)",
      )
      expect(SessionRunnerRetry.exhausted(cause, now)).toEqual({
        until: Date.parse("2026-09-26T08:00:00.000Z"),
        quota: true,
      })
    }),
  )

  it.effect("reads a router's retry-at and reason headers on an exhausted account", () =>
    Effect.sync(() => {
      const cause = new AIError({
        reason: new QuotaExceededError({
          message: "Provider request failed with HTTP 429",
          http: new HttpContext({
            url: "http://router.test/v1/chat/completions",
            status: 429,
            headers: { "x-9router-retry-at": "2026-09-25T13:00:00.000Z", "x-9router-reason": "quota_exhausted" },
          }),
        }),
      })
      expect(SessionRunnerRetry.exhausted(cause, now)).toEqual({ until: now + 3_600_000, quota: true })
    }),
  )

  it.effect("names the model, the reset time and what to do", () =>
    Effect.sync(() => {
      const message = SessionRunnerRetry.exhaustedMessage(
        "red-router · gpt-6-sol",
        { until: now + 3_600_000, quota: true },
        now,
      )
      expect(message).toStartWith("red-router · gpt-6-sol quota exhausted until ")
      expect(message).toEndWith("; switch model with /model or wait")
      expect(
        SessionRunnerRetry.exhaustedMessage("red-router · gpt-6-sol", { until: now + 3_600_000, quota: false }, now),
      ).toStartWith("red-router · gpt-6-sol unavailable until ")
    }),
  )
})

describe("SessionRunnerRetry.policy", () => {
  it.effect("ends the turn with a quota message instead of waiting out a far reset", () =>
    Effect.gen(function* () {
      const decide = yield* SessionRunnerRetry.policy(id)
      const decision = yield* decide(input(rateLimited("usage limit reached", 30 * 60_000)))
      expect(decision.retry).toBeFalse()
      if (decision.retry) return
      expect(decision.error?.type).toBe("provider.quota")
      expect(decision.error?.message).toStartWith("red-router · gpt-6-sol quota exhausted until ")
    }),
  )

  it.effect("still retries a reset within two minutes, honouring its delay", () =>
    Effect.gen(function* () {
      const decide = yield* SessionRunnerRetry.policy(id)
      const decision = yield* decide(input(rateLimited("Too many requests", 90_000)))
      expect(decision).toEqual({ retry: true, attempt: 2, delay: 90_000 })
    }),
  )

  it.effect("lets a hook wait out a far reset", () =>
    Effect.gen(function* () {
      const decide = yield* SessionRunnerRetry.policy(id)
      const decision = yield* decide({
        ...input(rateLimited("usage limit reached", 5 * 60_000)),
        hook: (event) =>
          Effect.sync(() => {
            event.decision = { retry: true, delay: 5 * 60_000 }
          }),
      })
      expect(decision).toEqual({ retry: true, attempt: 2, delay: 5 * 60_000 })
    }),
  )
})

describe("SessionRunnerRetry.make", () => {
  it.effect("selecting another model ends a pending wait and restarts the attempts", () =>
    Effect.gen(function* () {
      yield* seed()
      const bus = yield* Bus.Service
      const retry = yield* SessionRunnerRetry.make(bus, id)
      const first = yield* retry.decide(input(rateLimited("Too many requests", 60_000)))
      const second = yield* retry.decide(input(rateLimited("Too many requests", 60_000)))
      expect(second.retry && second.attempt).toBe(3)
      if (!first.retry) return
      let finished = false
      const waiting = yield* retry
        .wait({
          decision: first,
          assistantMessageID: SessionMessage.ID.create(),
          error: { type: "provider.rate-limit", message: "Too many requests" },
        })
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              finished = true
            }),
          ),
          Effect.forkScoped({ startImmediately: true }),
        )
      // The TestClock never advances, so only the switch can end the one-minute wait. Publishing until the
      // wait ends avoids depending on when its subscription starts.
      yield* bus
        .publish(SessionEvent.ModelSelected, { sessionID: id, model: Model.Ref.parse("openai/gpt-6-luna") })
        .pipe(Effect.andThen(Effect.yieldNow), Effect.repeat({ while: () => !finished }))
      yield* Fiber.join(waiting)
      const fresh = yield* retry.decide(input(rateLimited("Too many requests", 60_000)))
      expect(fresh.retry && fresh.attempt).toBe(2)
    }),
  )
})
