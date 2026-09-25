import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { Database } from "@reddb-io/redcode-core/database/database"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { GenerationTiming } from "@reddb-io/redcode-core/session/generation-timing"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OperationHookBridge } from "@/operation-hook-bridge"
import { expect } from "bun:test"
import { APICallError } from "ai"
import { Duration, Effect, Fiber, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { LLMEvent, type Usage } from "@reddb-io/redcode-llm"
import { OperationHook } from "@reddb-io/redcode-core/operation-hook"

// Every scenario scripts the provider: how long local preparation takes before the request, and
// when each event arrives after the previous one. The fake reads its script the way llm.ts reads a
// provider: it stamps output as it arrives and keeps reading while the processor handles earlier
// events. Timings are real sleeps, so bounds are loose; the exact rules are tested with a fake clock
// in core's generation-timing tests.
// Real sleeps also make these scenarios sensitive to a busy CPU: when CI runs other test files in
// parallel, event handling can take long enough to read as a burst. A retry absorbs one slow run
// without loosening what a passing run proves.
const slowCpu = { timeout: 20_000, retry: 2 }

// A virtual script runs on a TestClock instead. The provider sends every event at its scripted time
// before the processor handles any, so arrival stamps are exact and handling takes no clock time
// unless a hook advances it. Scenarios that assert a window's length or whether it was a burst use
// it: with real sleeps a loaded runner stretches the window and makes handling look like a burst.
const virtualClock = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.provide(TestClock.layer()))

type Step = { readonly after?: number } & ({ readonly event: LLMEvent } | { readonly fail: unknown })
type Script = { readonly prep?: number; readonly virtual?: boolean; readonly steps: readonly Step[] }

let scripts: Script[] = []
let calls = 0

const scriptedLLM = Layer.succeed(
  LLM.Service,
  LLM.Service.of({
    stream: (input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const script = scripts[Math.min(calls++, scripts.length - 1)]!
          if (script.virtual) {
            if (script.prep) yield* TestClock.adjust(Duration.millis(script.prep))
            input.timing?.request()
            const sent = yield* Effect.forEach(script.steps, (step) =>
              Effect.gen(function* () {
                if (step.after) yield* TestClock.adjust(Duration.millis(step.after))
                if ("event" in step && GenerationTiming.carriesToken(step.event)) input.timing?.arrived()
                return step
              }),
            )
            return Stream.fromIterable(sent).pipe(
              Stream.mapEffect((step) =>
                Effect.gen(function* () {
                  if ("fail" in step) return yield* Effect.fail(step.fail)
                  return step.event
                }),
              ),
            )
          }
          // Local request preparation happens before the provider is called, so it is not latency.
          if (script.prep) yield* Effect.sleep(Duration.millis(script.prep))
          input.timing?.request()
          return Stream.fromIterable(script.steps).pipe(
            Stream.mapEffect((step) =>
              Effect.gen(function* () {
                if (step.after) yield* Effect.sleep(Duration.millis(step.after))
                if ("fail" in step) return yield* Effect.fail(step.fail)
                if (GenerationTiming.carriesToken(step.event)) input.timing?.arrived()
                return step.event
              }),
            ),
            Stream.buffer({ capacity: "unbounded" }),
          )
        }),
      ),
  }),
)

// The text-end waterfall is where plugins and hooks run in the middle of a stream: a slow one holds up
// handling while the provider keeps sending. It runs in a virtual scenario, so it advances the TestClock.
let textCompleteDelayMs = 0
const slowHooks = Layer.succeed(
  OperationHookBridge.Service,
  OperationHookBridge.Service.of({
    waterfall: (definition, data) =>
      definition === OperationHook.Operation.Text.Complete && textCompleteDelayMs > 0
        ? TestClock.adjust(Duration.millis(textCompleteDelayMs)).pipe(Effect.as(data))
        : Effect.succeed(data),
    serial: () => Effect.void,
    parallel: () => Effect.void,
  }),
)

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") }

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: { apiKey: "test-key", baseURL: "http://localhost:1/v1" },
    },
  },
}

const root = LayerNode.group([
  SessionProcessor.node,
  Session.node,
  SessionProjector.node,
  Provider.node,
  Database.node,
  EventV2Bridge.node,
  SessionStatus.node,
  CrossSpawnSpawner.node,
])
const it = testEffect(
  LayerNode.compile(root, [
    [SessionSummary.node, summary],
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
    [OperationHookBridge.node, slowHooks],
    [LLM.node, scriptedLLM],
  ]),
)

const usage = (input: ConstructorParameters<typeof Usage>[0]) => input

const text = (count: number, every: number, first = every): Step[] =>
  Array.from({ length: count }, (_, index) => ({
    after: index === 0 ? first : every,
    event: LLMEvent.textDelta({ id: "text-1", text: `word${index} ` }),
  }))

const finish = (tokens: { output: number; reasoning?: number }, after = 0): Step[] => [
  { event: LLMEvent.textEnd({ id: "text-1" }) },
  {
    after,
    event: LLMEvent.stepFinish({
      index: 0,
      reason: "stop",
      usage: usage({
        inputTokens: 10,
        outputTokens: tokens.output + (tokens.reasoning ?? 0),
        reasoningTokens: tokens.reasoning,
      }),
    }),
  },
  { event: LLMEvent.finish({ reason: "stop" }) },
]

const opening: Step[] = [{ event: LLMEvent.stepStart({ index: 0 }) }, { event: LLMEvent.textStart({ id: "text-1" }) }]

const retryable = () =>
  new APICallError({
    message: "server_error",
    url: "http://localhost:1/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 503,
    responseHeaders: { "retry-after-ms": "10" },
    isRetryable: true,
  })

const setup = Effect.fn("test.setup")(function* (dir: string, input?: { summary?: boolean }) {
  const processors = yield* SessionProcessor.Service
  const session = yield* Session.Service
  const provider = yield* Provider.Service
  const chat = yield* session.create({})
  const parent = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: parent.id,
    sessionID: chat.id,
    type: "text",
    text: "hi",
  })
  const msg: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    path: { cwd: dir, root: dir },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID: parent.id,
    time: { created: Date.now() },
    ...(input?.summary ? { summary: true } : {}),
  }
  yield* session.updateMessage(msg)
  const model = yield* provider.getModel(ref.providerID, ref.modelID)
  const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model })
  const streamInput = {
    user: {
      id: parent.id,
      sessionID: chat.id,
      role: "user",
      time: parent.time,
      agent: "build",
      model: ref,
    } satisfies SessionV1.User,
    sessionID: chat.id,
    model,
    agent: { name: "build", mode: "primary", options: {}, permission: [] },
    system: [],
    messages: [{ role: "user", content: "hi" }],
    tools: {},
  } satisfies LLM.StreamInput
  return { chat, msg, handle, streamInput }
})

const stored = (sessionID: SessionID, messageID: MessageID) =>
  MessageV2.get({ sessionID, messageID }).pipe(Effect.map((item) => item.info as SessionV1.Assistant))

const reset = (next: Script[]) => {
  scripts = next
  calls = 0
  textCompleteDelayMs = 0
}

it.live(
  "timing starts at the first non-empty delta, not at an empty reasoning-start",
  () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          reset([
            {
              prep: 120,
              steps: [
                { event: LLMEvent.stepStart({ index: 0 }) },
                // OpenAI Responses opens a reasoning item before any reasoning exists.
                { after: 40, event: LLMEvent.reasoningStart({ id: "r-1" }) },
                { after: 200, event: LLMEvent.reasoningDelta({ id: "r-1", text: "" }) },
                {
                  after: 60,
                  event: LLMEvent.reasoningDelta({ id: "r-1", text: "Weighing the two approaches in detail" }),
                },
                { after: 30, event: LLMEvent.reasoningEnd({ id: "r-1" }) },
                { event: LLMEvent.textStart({ id: "text-1" }) },
                ...text(12, 40, 200),
                ...finish({ output: 60, reasoning: 8 }),
              ],
            },
          ])
          const { chat, msg, handle, streamInput } = yield* setup(dir)
          expect(yield* handle.process(streamInput)).toBe("continue")
          const info = yield* stored(chat.id, msg.id)
          const timing = info.timing!

          // 40 (framing) + 200 (empty delta) + 60 until the first real reasoning token.
          expect(timing.ttftMs).toBeGreaterThanOrEqual(290)
          expect(timing.ttftMs).toBeLessThan(600)
          // Visible output starts with the first text, after thinking.
          expect(timing.visibleMs! - timing.ttftMs!).toBeGreaterThanOrEqual(220)
          expect(timing.prepMs).toBeGreaterThanOrEqual(110)
          expect(timing).toMatchObject({ outputTokens: 60, reasoningTokens: 8, reasoningChars: 37 })
          expect(info.time.first).toBe(timing.firstToken)
          expect(timing.requestStarted! + timing.ttftMs!).toBeCloseTo(timing.firstToken!, -1)
        }),
      { config: cfg },
    ),
  slowCpu,
)

it.live(
  "tool execution and permission waits stay outside the generation window",
  () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          reset([
            {
              steps: [
                ...opening,
                ...text(10, 40, 100),
                { event: LLMEvent.textEnd({ id: "text-1" }) },
                { after: 30, event: LLMEvent.toolInputStart({ id: "call-1", name: "bash" }) },
                { after: 30, event: LLMEvent.toolInputDelta({ id: "call-1", name: "bash", text: '{"command":' }) },
                { after: 30, event: LLMEvent.toolInputDelta({ id: "call-1", name: "bash", text: '"bun test"}' }) },
                { event: LLMEvent.toolInputEnd({ id: "call-1", name: "bash" }) },
                { event: LLMEvent.toolCall({ id: "call-1", name: "bash", input: { command: "bun test" } }) },
                // The permission prompt and the test run: the SDK holds step-finish until the result exists.
                {
                  after: 1500,
                  event: LLMEvent.toolResult({ id: "call-1", name: "bash", result: { type: "text", value: "ok" } }),
                },
                {
                  event: LLMEvent.stepFinish({
                    index: 0,
                    reason: "tool-calls",
                    usage: usage({ inputTokens: 10, outputTokens: 120 }),
                  }),
                },
              ],
            },
          ])
          const { chat, msg, handle, streamInput } = yield* setup(dir)
          yield* handle.process(streamInput)
          const info = yield* stored(chat.id, msg.id)
          const timing = info.timing!

          expect(timing.genMs).toBeGreaterThanOrEqual(420)
          expect(timing.genMs).toBeLessThan(1200)
          const meter = GenerationTiming.meter([info])!
          expect(meter.step.speed?.type).toBe("rate")
          const rate = meter.step.speed?.type === "rate" ? meter.step.speed.value : 0
          // 120 tokens over roughly half a second, not over the two seconds the step took end to end.
          const endToEnd = 120 / ((info.time.completed! - timing.firstToken!) / 1000)
          expect(rate).toBeGreaterThan(100)
          expect(endToEnd).toBeLessThan(rate / 2)
        }),
      { config: cfg },
    ),
  slowCpu,
)

it.live("a slow hook while handling does not stretch the window: tokens are timed on arrival", () =>
  provideTmpdirInstance(
    (dir) =>
      virtualClock(
        Effect.gen(function* () {
          reset([
            {
              virtual: true,
              steps: [
                ...opening,
                ...text(6, 40, 50),
                // The first text part ends while more is on the way; its text-end hook takes 900 ms.
                { event: LLMEvent.textEnd({ id: "text-1" }) },
                { event: LLMEvent.textStart({ id: "text-2" }) },
                ...Array.from({ length: 6 }, (_, index) => ({
                  after: 40,
                  event: LLMEvent.textDelta({ id: "text-2", text: `more${index} ` }),
                })),
                { event: LLMEvent.textEnd({ id: "text-2" }) },
                { event: LLMEvent.stepFinish({ index: 0, reason: "stop", usage: usage({ outputTokens: 120 }) }) },
              ],
            },
          ])
          const { chat, msg, handle, streamInput } = yield* setup(dir)
          textCompleteDelayMs = 900
          yield* handle.process(streamInput)
          const timing = (yield* stored(chat.id, msg.id)).timing!

          // Twelve deltas arrive 440 ms apart end to end. Every one is handled after the last arrived,
          // and the second part only after the hook's 900: stamping when handled would read 900.
          expect(timing.genMs).toBe(440)
          // The hook waited outside the event loop: the stream is still a stream.
          expect(timing.burst).toBeUndefined()
        }),
      ),
    { config: cfg },
  ),
)

it.live(
  "a tool call whose input was never streamed counts as generated output",
  () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          reset([
            {
              steps: [
                { event: LLMEvent.stepStart({ index: 0 }) },
                { after: 250, event: LLMEvent.toolCall({ id: "call-1", name: "read", input: { path: "a.ts" } }) },
                {
                  after: 900,
                  event: LLMEvent.toolResult({ id: "call-1", name: "read", result: { type: "text", value: "x" } }),
                },
                { event: LLMEvent.stepFinish({ index: 0, reason: "tool-calls", usage: usage({ outputTokens: 30 }) }) },
              ],
            },
          ])
          const { chat, msg, handle, streamInput } = yield* setup(dir)
          yield* handle.process(streamInput)
          const timing = (yield* stored(chat.id, msg.id)).timing!

          expect(timing.ttftMs).toBeGreaterThanOrEqual(240)
          expect(timing.visibleMs).toBe(timing.ttftMs)
          expect(timing.genMs).toBe(0)
          expect(timing.burst).toBe(true)
        }),
      { config: cfg },
    ),
  slowCpu,
)

it.live(
  "a retried attempt measures its own request, first token and prep",
  () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          reset([
            {
              prep: 20,
              steps: [...opening, ...text(3, 20, 30), { after: 20, fail: retryable() }],
            },
            {
              prep: 150,
              steps: [...opening, ...text(10, 40, 300), ...finish({ output: 60 })],
            },
          ])
          const { chat, msg, handle, streamInput } = yield* setup(dir)
          expect(yield* handle.process(streamInput)).toBe("continue")
          expect(calls).toBe(2)
          const timing = (yield* stored(chat.id, msg.id)).timing!

          expect(timing.ttftMs).toBeGreaterThanOrEqual(290)
          // Only the retry's own preparation, not the first attempt and the wait before the retry.
          expect(timing.prepMs).toBeGreaterThanOrEqual(140)
          expect(timing.prepMs).toBeLessThan(400)
          expect(timing.outputTokens).toBe(60)
        }),
      { config: cfg },
    ),
  slowCpu,
)

it.live(
  "a discarded attempt does not leave its first token on the message",
  () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const database = yield* Database.Service
          reset([
            { steps: [...opening, ...text(2, 20, 30), { after: 400, fail: retryable() }] },
            { steps: [...opening, { after: 60_000, event: LLMEvent.textDelta({ id: "text-1", text: "never" }) }] },
          ])
          const { chat, msg, handle, streamInput } = yield* setup(dir)
          const run = yield* handle.process(streamInput).pipe(Effect.forkChild)
          const read = stored(chat.id, msg.id).pipe(Effect.provideService(Database.Service, database))

          const first = yield* poll(read, (info) => info.timing?.firstToken !== undefined)
          expect(first.timing?.ttftMs).toBeGreaterThanOrEqual(25)
          const cleared = yield* poll(read, (info) => calls === 2 && info.timing === undefined)
          expect(cleared.time.first).toBeUndefined()
          yield* Fiber.interrupt(run)
        }),
      { config: cfg },
    ),
  slowCpu,
)

it.live(
  "a summary never publishes its finish before cleanup",
  () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const database = yield* Database.Service
          reset([
            {
              steps: [
                ...opening,
                // A finish reason known before the first token is written: the write must not carry it.
                { event: LLMEvent.finish({ reason: "stop" }) },
                ...text(2, 20, 30),
                { after: 60_000, event: LLMEvent.textDelta({ id: "text-1", text: "never" }) },
              ],
            },
          ])
          const { chat, msg, handle, streamInput } = yield* setup(dir, { summary: true })
          const run = yield* handle.process(streamInput).pipe(Effect.forkChild)
          const read = stored(chat.id, msg.id).pipe(Effect.provideService(Database.Service, database))
          yield* poll(read, (info) => info.timing?.firstToken !== undefined)
          yield* Effect.sleep("100 millis")
          expect((yield* read).finish).toBeUndefined()
          yield* Fiber.interrupt(run)
        }),
      { config: cfg },
    ),
  slowCpu,
)

it.live(
  "latency is written as soon as the first token arrives and goes stale when aborted",
  () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const database = yield* Database.Service
          reset([
            { steps: [...opening, ...text(3, 30, 120), { after: 60_000, event: LLMEvent.finish({ reason: "stop" }) }] },
          ])
          const { chat, msg, handle, streamInput } = yield* setup(dir)
          const run = yield* handle.process(streamInput).pipe(Effect.forkChild)
          const read = stored(chat.id, msg.id).pipe(Effect.provideService(Database.Service, database))

          const live = yield* poll(read, (info) => info.timing?.firstToken !== undefined)
          const liveMeter = GenerationTiming.meter([live])!
          expect(live.time.completed).toBeUndefined()
          expect(liveMeter.step.latency).toBeGreaterThanOrEqual(110)
          expect(liveMeter.step.stale).toBe(false)
          expect(liveMeter.step.speed).toEqual({ type: "pending" })

          yield* Fiber.interrupt(run)
          const aborted = yield* read
          const meter = GenerationTiming.meter([aborted])!
          expect(aborted.error?.name).toBe("MessageAbortedError")
          expect(meter.step.stale).toBe(true)
          expect(meter.step.aborted).toBe(true)
          expect(meter.step.latency).toBe(liveMeter.step.latency)
          expect(meter.step.speed).toBeUndefined()
        }),
      { config: cfg },
    ),
  slowCpu,
)

it.live(
  "tokens delivered all at once show no rate",
  () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          // A non-streaming proxy: everything arrives at once after the provider finished. Whether it reads as
          // a burst or as too short a window depends on the machine; either way no number is shown.
          reset([{ steps: [...opening, ...text(40, 0, 900), ...finish({ output: 300 })] }])
          const { chat, msg, handle, streamInput } = yield* setup(dir)
          yield* handle.process(streamInput)
          const info = yield* stored(chat.id, msg.id)

          expect(info.timing?.ttftMs).toBeGreaterThanOrEqual(890)
          expect(["burst", "short"]).toContain(GenerationTiming.meter([info])?.step.speed?.type ?? "missing")
        }),
      { config: cfg },
    ),
  slowCpu,
)

it.live("reasoning that only streamed as a summary rates the visible output alone", () =>
  provideTmpdirInstance(
    (dir) =>
      virtualClock(
        Effect.gen(function* () {
          // 1,200 reasoning tokens happen before the first byte; only a one-line summary streams, then 80 text
          // tokens over 360 ms. Rating all 1,280 tokens over that window would show thousands of tk/s.
          reset([
            {
              virtual: true,
              steps: [
                { event: LLMEvent.stepStart({ index: 0 }) },
                { event: LLMEvent.reasoningStart({ id: "r-1" }) },
                { after: 1200, event: LLMEvent.reasoningDelta({ id: "r-1", text: "**Planning the change**" }) },
                { event: LLMEvent.reasoningEnd({ id: "r-1" }) },
                { event: LLMEvent.textStart({ id: "text-1" }) },
                ...text(10, 40, 20),
                ...finish({ output: 80, reasoning: 1200 }),
              ],
            },
          ])
          const { chat, msg, handle, streamInput } = yield* setup(dir)
          yield* handle.process(streamInput)
          const info = yield* stored(chat.id, msg.id)
          const speed = GenerationTiming.meter([info])?.step.speed

          expect(info.timing).toMatchObject({
            outputTokens: 80,
            reasoningTokens: 1200,
            reasoningChars: 23,
            genMs: 380,
            visibleGenMs: 360,
          })
          expect(speed).toMatchObject({ type: "rate", hidden: true })
          const value = speed?.type === "rate" ? speed.value : 0
          expect(value).toBeCloseTo(80 / 0.36)
        }),
      ),
    { config: cfg },
  ),
)

it.live(
  "replayed compaction events are marked replayed and measure nothing",
  () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          reset([{ steps: [] }])
          const { chat, msg, handle, streamInput } = yield* setup(dir, { summary: true })
          const collected = [
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.textStart({ id: "text-1" }),
            ...Array.from({ length: 50 }, (_, index) => LLMEvent.textDelta({ id: "text-1", text: `summary${index} ` })),
            LLMEvent.textEnd({ id: "text-1" }),
            LLMEvent.stepFinish({ index: 0, reason: "stop", usage: usage({ inputTokens: 10, outputTokens: 400 }) }),
            LLMEvent.finish({ reason: "stop" }),
          ]
          yield* handle.process(streamInput, collected)
          const info = yield* stored(chat.id, msg.id)

          expect(calls).toBe(0)
          expect(info.timing).toEqual({ replayed: true })
          expect(info.time.first).toBeUndefined()
          expect(GenerationTiming.meter([info])).toBeUndefined()
        }),
      { config: cfg },
    ),
  slowCpu,
)

function poll<A>(read: Effect.Effect<A, unknown>, done: (value: A) => boolean) {
  return Effect.gen(function* () {
    const stop = Date.now() + 5_000
    while (Date.now() < stop) {
      const value = yield* read
      if (done(value)) return value
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.fail(new Error("timed out waiting for the message"))
  })
}
