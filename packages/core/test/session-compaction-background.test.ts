import { expect } from "bun:test"
import { DateTime, Deferred, Effect, Fiber, Schema, Scope, Stream } from "effect"
import { LLM, LLMEvent, Message, Model } from "@reddb-io/redcode-llm"
import { route } from "@reddb-io/redcode-llm/protocols/openai-chat"
import { Config } from "@reddb-io/redcode-core/config"
import { ConfigCompaction } from "@reddb-io/redcode-core/config/compaction"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { SessionCompaction } from "@reddb-io/redcode-core/session/compaction"
import { SessionEvent } from "@reddb-io/redcode-core/session/event"
import { SessionMessage } from "@reddb-io/redcode-core/session/message"
import { SessionSchema } from "@reddb-io/redcode-core/session/schema"
import { it } from "./lib/effect"
import { adjust } from "effect/testing/TestClock"

const setup = (auto = true, background = true) =>
  Effect.gen(function* () {
    const sessionID = SessionSchema.ID.create()
    const original = SessionMessage.User.make({
      id: SessionMessage.ID.create(),
      type: "user",
      text: "Do not publish; validate my parser.",
      time: { created: DateTime.makeUnsafe(0) },
    })
    const earlier = SessionMessage.User.make({
      ...original,
      id: SessionMessage.ID.create(),
      text: "Earlier investigation. ".repeat(1700),
    })
    const model = Model.make({
      id: "test",
      provider: "test",
      route: route.with({ limits: { context: 14_000, output: 1_000 } }),
    })
    const gate = yield* Deferred.make<void>()
    const started = yield* Deferred.make<void>()
    const stopped = yield* Deferred.make<void>()
    const published: EventV2.Payload[] = []
    const outputs: LLMEvent[][] = []
    const calls: string[] = []
    const compaction = SessionCompaction.make({
      scope: yield* Scope.Scope,
      latestUser: () => Effect.succeed(original),
      config: [
        new Config.Document({
          type: "document",
          info: new Config.Info({
            compaction: new ConfigCompaction.Info({
              auto,
              background,
              buffer: 3_000,
              keep: new ConfigCompaction.Keep({ tokens: 100 }),
            }),
          }),
        }),
      ],
      beforeCompact: () => Effect.succeed({ continue: true }),
      events: {
        publish: (definition, data) =>
          Effect.sync(() => {
            const event = { id: EventV2.ID.create(), type: definition.type, data }
            published.push(event)
            return event
          }),
      },
      llm: {
        stream: () => {
          calls.push("summary")
          const response = outputs.shift() ?? [
            LLMEvent.textDelta({ id: "s", text: "Investigated parser." }),
            LLMEvent.finish({ reason: "stop" }),
          ]
          return Stream.unwrap(
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(gate)),
              Effect.as(Stream.fromIterable(response)),
              Effect.ensuring(Deferred.succeed(stopped, undefined)),
            ),
          ).pipe(Stream.ensuring(Deferred.succeed(stopped, undefined)))
        },
      },
    })
    const entries = [
      { seq: 0, message: earlier },
      { seq: 1, message: original },
    ]
    const input = {
      sessionID,
      model,
      entries,
      request: LLM.request({ model, messages: [Message.user("x".repeat(41_000))], tools: [] }),
    }
    return { compaction, input, original, gate, started, stopped, published, calls, outputs }
  })

it.effect("prepares without blocking or publishing and preserves messages added before application", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    expect(yield* test.compaction.compactIfNeeded(test.input)).toBe(false)
    yield* Deferred.await(test.started)
    expect(test.published).toHaveLength(0)
    // Repeated preflight checks share the same in-flight summary.
    expect(yield* test.compaction.compactIfNeeded(test.input)).toBe(false)
    expect(test.calls).toHaveLength(1)
    const correction = SessionMessage.User.make({
      ...test.original,
      id: SessionMessage.ID.create(),
      text: "Only change tests now.",
    })
    const apply = yield* test.compaction
      .compactAfterOverflow({
        ...test.input,
        entries: [...test.input.entries, { seq: 2, message: correction }],
      })
      .pipe(Effect.forkChild)
    yield* Deferred.succeed(test.gate, undefined)
    expect(yield* Fiber.join(apply)).toBe(true)
    expect(test.calls).toHaveLength(1)
    const ended = test.published.find(Schema.is(Schema.toType(SessionEvent.Compaction.Ended)))
    expect(ended?.data.recent).toContain(test.original.text)
    expect(ended?.data.recent).toContain(correction.text)
  }),
)

for (const change of ["history", "model", "system"] as const) {
  it.effect(`discards background results when ${change} changes`, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      yield* test.compaction.compactIfNeeded(test.input)
      yield* Deferred.await(test.started)
      yield* Deferred.succeed(test.gate, undefined)
      const input =
        change === "history"
          ? {
              ...test.input,
              entries: [
                {
                  ...test.input.entries[0],
                  message: { ...test.input.entries[0].message, text: "Rewritten investigation ".repeat(1700) },
                },
                test.input.entries[1],
              ],
            }
          : change === "model"
            ? { ...test.input, model: Model.make({ ...test.input.model, id: "replacement" }) }
            : {
                ...test.input,
                request: LLM.request({ ...test.input.request, system: "A corrected system instruction" }),
              }
      expect(yield* test.compaction.compactAfterOverflow(input)).toBe(true)
      expect(test.calls).toHaveLength(2)
    }),
  )
}

it.live("cancels preparation when the owning session drain finishes", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    yield* test.compaction.compactIfNeeded(test.input)
    yield* Deferred.await(test.started)
    yield* test.compaction
      .discard(test.input.sessionID)
      .pipe(Effect.timeoutOrElse({ duration: "1 second", orElse: () => Effect.die("discard did not return") }))
    yield* Deferred.await(test.stopped).pipe(
      Effect.timeoutOrElse({ duration: "1 second", orElse: () => Effect.die("provider was not interrupted") }),
    )
    expect(test.published).toHaveLength(0)
    yield* Deferred.succeed(test.gate, undefined)
    expect(yield* test.compaction.compactAfterOverflow(test.input)).toBe(true)
    expect(test.calls).toHaveLength(2)
  }),
)

it.effect("does not speculate when automatic compaction is disabled", () =>
  Effect.gen(function* () {
    const test = yield* setup(false)
    expect(yield* test.compaction.compactIfNeeded(test.input)).toBe(false)
    expect(test.calls).toHaveLength(0)
    expect(test.published).toHaveLength(0)
  }),
)

it.effect("cancels a stalled preparation at its deadline without publishing it", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    yield* test.compaction.compactIfNeeded(test.input)
    yield* Deferred.await(test.started)
    yield* adjust("2 minutes")
    yield* Deferred.await(test.stopped)
    expect(test.published).toHaveLength(0)
    yield* test.compaction.discard(test.input.sessionID)
  }),
)

it.effect("falls back to a fresh summary after speculative output is rejected", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    test.outputs.push([
      LLMEvent.textDelta({ id: "s", text: "Truncated summary" }),
      LLMEvent.finish({ reason: "length" }),
    ])
    yield* test.compaction.compactIfNeeded(test.input)
    yield* Deferred.await(test.started)
    yield* Deferred.succeed(test.gate, undefined)
    expect(yield* test.compaction.compactAfterOverflow(test.input)).toBe(true)
    expect(test.calls).toHaveLength(2)
    expect(test.published.filter((event) => event.type === SessionEvent.Compaction.Ended.type)).toHaveLength(1)
  }),
)

it.effect("disabling preparation still allows ordinary automatic compaction", () =>
  Effect.gen(function* () {
    const test = yield* setup(true, false)
    expect(yield* test.compaction.compactIfNeeded(test.input)).toBe(false)
    yield* adjust("2 minutes")
    expect(test.calls).toHaveLength(0)
    yield* Deferred.succeed(test.gate, undefined)
    expect(
      yield* test.compaction.compactIfNeeded({
        ...test.input,
        request: LLM.request({ ...test.input.request, messages: [Message.user("x".repeat(48_000))] }),
      }),
    ).toBe(true)
    expect(test.calls).toHaveLength(1)
  }),
)
