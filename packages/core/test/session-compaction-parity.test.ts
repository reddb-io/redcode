import { expect, test } from "bun:test"
import { DateTime, Effect, Schema, Scope, Stream } from "effect"
import { LLM, LLMEvent, Message, Model, type LLMRequest } from "@reddb-io/redcode-llm"
import { route } from "@reddb-io/redcode-llm/protocols/openai-chat"
import { Config } from "@reddb-io/redcode-core/config"
import { ConfigCompaction } from "@reddb-io/redcode-core/config/compaction"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { SessionCompaction } from "@reddb-io/redcode-core/session/compaction"
import { CompactionGuardStore } from "@reddb-io/redcode-core/session/compaction-guard-store"
import { SessionEvent } from "@reddb-io/redcode-core/session/event"
import { SessionMessage } from "@reddb-io/redcode-core/session/message"
import { SessionSchema } from "@reddb-io/redcode-core/session/schema"
import { Token } from "@reddb-io/redcode-core/util/token"
import { it } from "./lib/effect"

const time = { created: DateTime.makeUnsafe(0) }
const user = (text: string) => SessionMessage.User.make({ id: SessionMessage.ID.create(), type: "user", text, time })
const assistant = (content: SessionMessage.AssistantContent[]) =>
  SessionMessage.Assistant.make({
    id: SessionMessage.ID.create(),
    type: "assistant",
    agent: "build",
    model: { id: "test", providerID: "test" } as never,
    content,
    time,
  })
const text = (value: string) => assistant([{ type: "text", id: "t", text: value }])

type Setup = {
  readonly context: number
  readonly output: number
  readonly messages: readonly SessionMessage.Message[]
  readonly keep?: number
  readonly summaryMaxTokens?: number
  readonly system?: string
  readonly store?: SessionCompaction.GuardStore
  readonly sessionID?: SessionSchema.ID
  readonly reply?: LLMEvent[]
}

const setup = (options: Setup) =>
  Effect.gen(function* () {
    const sessionID = options.sessionID ?? SessionSchema.ID.create()
    const model = Model.make({
      id: "test",
      provider: "test",
      route: route.with({ limits: { context: options.context, output: options.output } }),
    })
    const requests: LLMRequest[] = []
    const published: EventV2.Payload[] = []
    const latest = options.messages.findLast((message) => message.type === "user") as SessionMessage.User | undefined
    const compaction = SessionCompaction.make({
      scope: yield* Scope.Scope,
      latestUser: () => Effect.succeed(latest),
      config: [
        new Config.Document({
          type: "document",
          info: new Config.Info({
            compaction: new ConfigCompaction.Info({
              background: false,
              ...(options.keep === undefined ? {} : { keep: new ConfigCompaction.Keep({ tokens: options.keep }) }),
              ...(options.summaryMaxTokens === undefined
                ? {}
                : { summary_max_tokens: options.summaryMaxTokens }),
            }),
          }),
        }),
      ],
      beforeCompact: () => Effect.succeed({ continue: true }),
      ...(options.store ? { guardStore: options.store } : {}),
      events: {
        publish: (definition, data) =>
          Effect.sync(() => {
            const event = { id: EventV2.ID.create(), type: definition.type, data }
            published.push(event)
            return event
          }),
      },
      llm: {
        stream: (request) => {
          requests.push(request)
          return Stream.fromIterable(
            options.reply ?? [LLMEvent.textDelta({ id: "s", text: "Summary." }), LLMEvent.finish({ reason: "stop" })],
          )
        },
      },
    })
    const input = {
      sessionID,
      model,
      entries: options.messages.map((message, seq) => ({ seq, message })),
      request: LLM.request({ model, system: options.system, messages: [Message.user("x")], tools: [] }),
    }
    const ended = () => published.find(Schema.is(Schema.toType(SessionEvent.Compaction.Ended)))?.data
    return { compaction, input, requests, ended }
  })

const conversation = (turns: number, tokens: number) =>
  Array.from({ length: turns }, (_, index) => [
    user(`REQUEST-${index} ${"word ".repeat((tokens * 4) / 5)}`),
    text(`ANSWER-${index}`),
  ]).flat()

it.effect("a large window keeps a proportional tail verbatim", () =>
  Effect.gen(function* () {
    // Usable is 400k - 20k = 380k, so the tail is 38k tokens: about eighteen 2k-token turns.
    const test = yield* setup({ context: 400_000, output: 8_000, messages: conversation(40, 2_000) })
    expect(yield* test.compaction.compactAfterOverflow(test.input)).toBe(true)
    const recent = test.ended()?.recent ?? ""
    expect(recent).toContain("REQUEST-39")
    // An 8k tail would stop at REQUEST-36.
    expect(recent).toContain("REQUEST-25")
    expect(recent).not.toContain("REQUEST-10 ")
  }),
)

it.effect("the last turn stays verbatim when the whole conversation fits", () =>
  Effect.gen(function* () {
    const messages = [user("FIRST-REQUEST"), text("FIRST-ANSWER"), user("SECOND-REQUEST"), text("SECOND-ANSWER")]
    const test = yield* setup({ context: 400_000, output: 8_000, messages })
    expect(yield* test.compaction.compactAfterOverflow(test.input)).toBe(true)
    const recent = test.ended()?.recent ?? ""
    expect(recent).toContain("SECOND-REQUEST")
    expect(recent).toContain("SECOND-ANSWER")
    expect(recent).not.toContain("FIRST-ANSWER")
  }),
)

it.effect("a single fitting turn has nothing before it to summarize", () =>
  Effect.gen(function* () {
    // Splitting off its last step left a head too small for any summary to shrink.
    const messages = [user("ONLY-REQUEST"), text("STEP-ONE"), text("STEP-TWO")]
    const test = yield* setup({ context: 400_000, output: 8_000, messages })
    expect(yield* test.compaction.compactAfterOverflow(test.input)).toBe(false)
    expect(test.requests).toHaveLength(0)
  }),
)

it.effect("a transcript larger than the window still compacts by eliding its middle", () =>
  Effect.gen(function* () {
    // About 600k tokens of conversation against a 400k window: prepare used to give up, so a
    // session the provider had already refused could only repeat the refusal. The summary request
    // now keeps the newest part, elides the middle, and stays inside the window.
    const test = yield* setup({ context: 400_000, output: 8_000, messages: conversation(400, 2_000) })
    expect(yield* test.compaction.compactAfterOverflow(test.input)).toBe(true)
    const request = test.requests[0]
    expect(request).toBeDefined()
    // Input plus the completion it asks for stays inside the window, measured as sizeOf does.
    const size = Token.estimate(
      JSON.stringify({ system: request!.system, messages: request!.messages, tools: request!.tools }),
    )
    expect(size + (request?.generation?.maxTokens ?? 0)).toBeLessThanOrEqual(400_000)
  }),
)

it.effect("the summary may use up to 32k output tokens", () =>
  Effect.gen(function* () {
    const test = yield* setup({ context: 400_000, output: 64_000, messages: conversation(4, 2_000) })
    expect(yield* test.compaction.compactAfterOverflow(test.input)).toBe(true)
    expect(test.requests[0]?.generation?.maxTokens).toBe(32_000)
  }),
)

it.effect("a configured summary_max_tokens raises the summary's output budget", () =>
  Effect.gen(function* () {
    const test = yield* setup({
      context: 400_000,
      output: 32_000,
      messages: conversation(4, 2_000),
      summaryMaxTokens: 32_000,
    })
    expect(yield* test.compaction.compactAfterOverflow(test.input)).toBe(true)
    expect(test.requests[0]?.generation?.maxTokens).toBe(32_000)
  }),
)

it.effect("a summary cut off by the length limit is still committed", () =>
  Effect.gen(function* () {
    const test = yield* setup({
      context: 400_000,
      output: 8_000,
      messages: conversation(4, 2_000),
      reply: [LLMEvent.textDelta({ id: "s", text: "Partial" }), LLMEvent.finish({ reason: "length" })],
    })
    expect(yield* test.compaction.compactAfterOverflow(test.input)).toBe(true)
    expect(test.ended()).toBeDefined()
  }),
)

it.effect("a length finish with no summary text is rejected", () =>
  Effect.gen(function* () {
    const test = yield* setup({
      context: 400_000,
      output: 8_000,
      messages: conversation(4, 2_000),
      reply: [LLMEvent.finish({ reason: "length" })],
    })
    expect(yield* test.compaction.compactAfterOverflow(test.input)).toBe(false)
    expect(test.ended()).toBeUndefined()
  }),
)

test("summaryError only rejects a length finish that wrote nothing", () => {
  expect(
    SessionCompaction.summaryError({ summary: "Partial", source: "x".repeat(1_000), finish: "length" }),
  ).toBeUndefined()
  expect(SessionCompaction.summaryError({ summary: " ", source: "x".repeat(1_000), finish: "length" })).toContain(
    "length",
  )
})

it.effect("the published summary carries code-built anchors", () =>
  Effect.gen(function* () {
    const read = assistant([
      {
        type: "tool",
        id: "call-read",
        name: "read",
        state: { status: "completed", input: { filePath: "src/parser.ts" }, content: [], structured: {} },
        time,
      },
    ])
    const edit = assistant([
      {
        type: "tool",
        id: "call-edit",
        name: "edit",
        state: { status: "completed", input: { filePath: "src/parser.ts" }, content: [], structured: {} },
        time,
      },
    ])
    const messages = [
      user("Fix the parser from PR #259, see https://example.com/issue and commit a1b2c3d4."),
      read,
      edit,
      user("Now the tests."),
      text("Done."),
    ]
    const test = yield* setup({ context: 400_000, output: 8_000, messages })
    expect(yield* test.compaction.compactAfterOverflow(test.input)).toBe(true)
    const summary = test.ended()?.text ?? ""
    expect(summary).toStartWith("Summary.")
    expect(summary).toContain("<session-anchors>")
    expect(summary).toContain("- src/parser.ts (1×)")
    expect(summary).toContain("#259")
    expect(summary).toContain("https://example.com/issue")
    expect(summary).toContain("a1b2c3d4")
    expect(summary.indexOf("Now the tests.")).toBeLessThan(summary.indexOf("Fix the parser"))
  }),
)

it.effect("a compaction pause survives a restart that shares the store", () =>
  Effect.gen(function* () {
    const saved = new Map<SessionSchema.ID, SessionCompaction.GuardSnapshot>()
    const store: SessionCompaction.GuardStore = {
      get: (sessionID) => Effect.sync(() => saved.get(sessionID)),
      set: (sessionID, snapshot) =>
        Effect.sync(() => {
          if (snapshot) saved.set(sessionID, snapshot)
          else saved.delete(sessionID)
        }),
    }
    const sessionID = SessionSchema.ID.create()
    const options = {
      // Usable is 30k - 20k = 10k, and the system prompt alone is 10k tokens.
      context: 30_000,
      output: 1_000,
      keep: 100,
      // A system prompt that alone keeps every next request above the band.
      system: "s".repeat(40_000),
      messages: [user(`Earlier ${"investigation ".repeat(1_700)}`), user("Validate my parser.")],
      store,
      sessionID,
    }
    const first = yield* setup(options)
    expect(yield* first.compaction.compactAfterOverflow(first.input)).toBe(true)
    expect(yield* first.compaction.compactAfterOverflow(first.input)).toBe(true)
    expect(saved.get(sessionID)?.paused).toBeDefined()

    const restarted = yield* setup(options)
    expect(yield* restarted.compaction.compactAfterOverflow(restarted.input)).toBe(false)
    expect(restarted.requests).toHaveLength(0)
  }),
)

test("the stored pause reads back in the legacy metadata shape", () => {
  expect(
    CompactionGuardStore.fromMetadata({ compaction: { ineffective: 2, request: "msg_a", paused: { after: "msg_a", at: 1 } } }),
  ).toEqual({ ineffective: 2, request: "msg_a", paused: "msg_a" })
  expect(CompactionGuardStore.fromMetadata({ compaction: { ineffective: 0 } })).toBeUndefined()
  expect(CompactionGuardStore.fromMetadata({ other: true })).toBeUndefined()
})
