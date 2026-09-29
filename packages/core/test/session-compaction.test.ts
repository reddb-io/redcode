import { expect, test } from "bun:test"
import { GenerationOptions, LLMClient, LLMEvent, LanguageModel, ToolDefinition, type LLMRequest } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { llmClient } from "@opencode/core/effect/app-node-platform"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { EventTable } from "@opencode/core/event/sql"
import { Instructions } from "@opencode/core/instructions/index"
import { SessionCompaction } from "@opencode/core/session/compaction"
import type { SessionContext } from "@opencode/core/session/context"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionModelRequest } from "@opencode/core/session/model-request"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { toLLMMessages } from "@opencode/core/session/runner/to-llm-message"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { Session } from "@opencode/core/session"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { App } from "@opencode/core/app"
import { Agent } from "@opencode/core/agent"
import { Location } from "@opencode/core/location"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Money } from "@opencode/schema/money"
import { Skill } from "@opencode/schema/skill"
import { Shell } from "@opencode/schema/shell"
import { DateTime, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { asc, eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

let requests: LLMRequest[] = []
/** Appended to the mocked summary, to stand for a summarizer that repeats what it read. */
let echo = ""
const summary = [
  "## Objective", "- Continue the user's work.",
  "## Requirements", "- Preserve the user's constraints.",
  "## Decisions", "- (none)",
  "## Work State", "### Completed", "- (none)",
  "### Active", "- Continue the task.",
  "### Blocked", "- (none)",
  "## Next Move", "1. Continue from the checkpoint.",
  "## Relevant Files", "- (none)",
  "## Important Context", "- (none)",
].join("\n")
const model = LanguageModel.make({
  id: "summary-model",
  provider: "test",
  route: OpenAIChat.route,
})
const cost = [
  {
    input: Money.USDPerMillionTokens.make(1),
    output: Money.USDPerMillionTokens.make(2),
    cache: {
      read: Money.USDPerMillionTokens.make(0.1),
      write: Money.USDPerMillionTokens.make(0.5),
    },
  },
]
const client = Layer.mock(LLMClient.Service)({
  stream: (request: LLMRequest) => {
    requests.push(request)
    return Stream.make(
      LLMEvent.textDelta({ id: "summary", text: summary + echo }),
      LLMEvent.stepFinish({
        index: 0,
        reason: { normalized: "stop" },
        usage: {
          inputTokens: 15,
          outputTokens: 6,
          nonCachedInputTokens: 10,
          cacheReadInputTokens: 3,
          cacheWriteInputTokens: 2,
          reasoningTokens: 2,
        },
      }),
      LLMEvent.finish({
        reason: { normalized: "stop" },
      }),
    )
  },
  generate: () => Effect.die("unused"),
})
const resolved = SessionRunnerModel.resolved(model, {
  capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
  cost,
  limit: { context: 200_000, output: 32_000 },
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      SessionCompaction.node,
      SessionModelRequest.node,
      PluginHooks.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      llmClient.replace(client),
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make(process.cwd()) })),
    ],
  ),
)

test("compaction prompt preserves detailed work state and relevant files", () => {
  const prompt = SessionCompaction.buildPrompt(false)

  expect(prompt).toContain("## Work State")
  expect(prompt).toContain("### Completed")
  expect(prompt).toContain("### Active")
  expect(prompt).toContain("### Blocked")
  expect(prompt).toContain("## Relevant Files")
})

test("a generated checkpoint needs complete, ordered, nonempty sections", () => {
  expect(SessionCompaction.validSummary(summary)).toBe(true)
  expect(SessionCompaction.validSummary("## Objective\n- only one section")).toBe(false)
  expect(SessionCompaction.validSummary(summary.replace("## Important Context\n- (none)", "## Important Context"))).toBe(false)
  expect(SessionCompaction.validSummary(summary.replace("## Requirements", "## Wrong Heading"))).toBe(false)
})

test("ineffective automatic checkpoints pause durably for the same user request", () => {
  const first = SessionCompaction.nextGuard({ ineffective: 0 }, "user-1", 86_000, 100_000)
  const second = SessionCompaction.nextGuard(first, "user-1", 88_000, 100_000)
  expect(SessionCompaction.guardPaused(second, "user-1")).toBe(true)
  expect(SessionCompaction.guardPaused(second, "user-2")).toBe(false)
  expect(SessionCompaction.guardFromMetadata({ compaction: {
    request: second.request ?? "",
    ineffective: second.ineffective,
    paused: { after: second.paused ?? "", at: 1 },
  } })).toEqual(second)
  expect(SessionCompaction.nextGuard(second, "user-2", 87_000, 100_000).ineffective).toBe(1)
  expect(SessionCompaction.nextGuard(second, "user-1", 80_000, 100_000).ineffective).toBe(0)
})

test("deterministic anchors preserve user wording and file paths within a fixed budget", () => {
  const messages = [
    SessionMessage.User.make({ id: SessionMessage.ID.create(), type: "user", text: "Fix ./src/main.ts for #42", time: { created: DateTime.makeUnsafe(0) } }),
  ]
  const anchors = SessionCompaction.buildAnchors(messages)
  expect(anchors).toContain("Fix ./src/main.ts for #42")
  expect(anchors).toContain("./src/main.ts")
  expect(anchors).toContain("#42")
  expect(SessionCompaction.stripAnchors(`${summary}\n\n${anchors}`)).toBe(summary)
})

it.effect("compaction describes tool media without embedding base64", () =>
  Effect.gen(function* () {
    const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
    const recent = yield* recentWithToolOutput(Session.ID.make("ses_tool_media"), [
      { type: "text", text: "Image read successfully" },
      {
        type: "file",
        uri: `data:image/png;base64,${base64}`,
        mime: "image/png",
        name: "pixel.png",
      },
    ])

    expect(recent).toContain("[Tool result]: Image read successfully\n[Attached image/png: pixel.png]")
    expect(recent).not.toContain(base64)
  }),
)

it.effect("compaction truncation does not split surrogate pairs", () =>
  Effect.gen(function* () {
    const prefix = "a".repeat(1_249)
    const split = yield* recentWithToolOutput(Session.ID.make("ses_truncate_split"), [
      { type: "text", text: `${prefix}😀suffix` },
    ])
    const whole = yield* recentWithToolOutput(Session.ID.make("ses_truncate_whole"), [
      { type: "text", text: "😀".repeat(1_250) },
    ])

    expect(split).toEndWith(`[Tool result]: ${prefix}😀\n[truncated]`)
    expect(whole).toEndWith(`[Tool result]: ${"😀".repeat(1_250)}`)
  }),
)

test("compaction prompt requires the checkpoint headings in order", () => {
  const prompt = SessionCompaction.buildPrompt(false)
  expect(prompt.match(/^#{2,3} .+$/gm)).toEqual([
    "## Objective",
    "## Requirements",
    "## Decisions",
    "## Work State",
    "### Completed",
    "### Active",
    "### Blocked",
    "## Next Move",
    "## Relevant Files",
    "## Important Context",
  ])
})

test("compaction update prompt rewrites legacy checkpoints only when asked", () => {
  const rewrite = "The existing checkpoint was written with an earlier format"
  expect(SessionCompaction.buildPrompt(true, true)).toContain(rewrite)
  expect(SessionCompaction.buildPrompt(true)).not.toContain(rewrite)
  expect(SessionCompaction.buildPrompt(false, true)).not.toContain(rewrite)
})

test("compaction prompts prohibit task execution", () => {
  for (const update of [false, true])
    expect(SessionCompaction.buildPrompt(update)).toContain("Do not continue the task or call tools")
})

it.effect("automatic compaction preserves history when a checkpoint would not reduce it", () =>
  Effect.gen(function* () {
    const compaction = yield* SessionCompaction.Service
    const session = yield* insertSession(Session.ID.make("ses_non_reducing_compaction"))
    const messages = [
      SessionMessage.User.make({
        id: SessionMessage.ID.create(), type: "user",
        text: Array.from({ length: 65 }, (_, index) => `Keep ./file-${index}.ts`).join(" "),
        time: { created: DateTime.makeUnsafe(0) },
      }),
      Schema.decodeUnknownSync(SessionMessage.Assistant)({
        id: SessionMessage.ID.create(), type: "assistant", agent: Agent.defaultID,
        model: { id: "summary-model", providerID: "test" },
        content: [{ type: "text", text: "Okay." }],
        tokens: { input: 180_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, completed: 1 },
      }),
    ]
    expect(yield* compaction.compact({ reason: "auto", context: loaded(session, messages) })).toMatchObject({
      status: "failed",
      error: { message: "Compaction summary did not reduce the conversation" },
    })
    const stored = yield* (yield* SessionStore.Service).context(session.id)
    expect(stored.some((message) => message.type === "compaction" && message.status === "failed")).toBe(true)
  }),
)

it.effect("auto compaction estimates current content against the buffered prompt ceiling", () =>
  Effect.gen(function* () {
    const compaction = yield* SessionCompaction.Service
    const session = yield* insertSession(Session.ID.make("ses_input_limit"))
    const input = (tokens: number, limit: { context: number; input?: number; output: number }) => ({
      session,
      model: SessionRunnerModel.resolved(model, {
        capabilities: { tools: true, input: ["text", "image", "pdf"], output: ["text"] },
        cost: [],
        limit,
      }),
      messages: [
        Schema.decodeUnknownSync(SessionMessage.Assistant)({
          id: SessionMessage.ID.make("msg_assistant"),
          type: "assistant",
          agent: Agent.defaultID,
          model: { id: "summary-model", providerID: "test" },
          content: [{ type: "text", text: "Done" }],
          tokens: { input: tokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, completed: 0 },
        }),
      ],
      agent: {
        id: Agent.defaultID,
        info: { ...Agent.Info.default(Agent.defaultID), system: "You are a helpful assistant." },
      },
      initial: "Project instructions.",
      tools: {
        definitions: [
          ToolDefinition.make({ name: "read", description: "Read files", inputSchema: { type: "object" } }),
        ],
        execute: () => Effect.die("unused"),
      },
    })
    // An automatic compaction that is not due is skipped.
    const due = (context: SessionContext.Loaded) =>
      compaction.compact({ reason: "auto", context }).pipe(Effect.map((outcome) => outcome.status !== "skipped"))

    // 90% of the input limit, which takes precedence over the context window.
    const inputLimited = { context: 400_000, input: 272_000, output: 128_000 }
    expect(yield* due(input(244_799, inputLimited))).toBe(false)
    expect(yield* due(input(244_800, inputLimited))).toBe(true)
    const native = (tokens: number, limit: { context: number; input?: number; output: number } = inputLimited) => {
      const selected = input(tokens, limit)
      return { ...selected, model: { ...selected.model, compaction: { type: "native" as const } } }
    }
    expect(yield* due(native(244_799))).toBe(false)
    expect(yield* due(native(244_800))).toBe(true)
    expect(yield* due(native(1_000_000, { context: 0, input: undefined, output: 0 }))).toBe(false)

    // The summary's 16k output limit is more than 10% of a 100k window, so it sets the ceiling.
    const contextLimited = { context: 100_000, output: 10_000 }
    expect(yield* due(input(83_999, contextLimited))).toBe(false)
    expect(yield* due(input(84_000, contextLimited))).toBe(true)

    // The reply limit does not lower the ceiling.
    const outputLimited = { context: 100_000, output: 30_000 }
    expect(yield* due(input(83_999, outputLimited))).toBe(false)
    expect(yield* due(input(84_000, outputLimited))).toBe(true)

    const assistant = input(89_000, contextLimited).messages[0]
    const tool = SessionMessage.AssistantTool.make({
      type: "tool",
      id: "call_read",
      name: "read",
      state: { status: "completed", input: {}, content: [{ type: "text", text: "x".repeat(4_000) }] },
      time: { created: DateTime.makeUnsafe(0) },
    })
    const grown = { ...input(89_000, contextLimited), messages: [{ ...assistant, content: [tool] }] }
    expect(SessionCompaction.estimateContext(grown)).toBe(90_000)
    expect(yield* due(grown)).toBe(true)

    const interrupted = { ...assistant, id: SessionMessage.ID.create(), tokens: undefined }
    expect(SessionCompaction.estimateContext({ ...grown, messages: [...grown.messages, interrupted] })).toBe(90_001)
    // Without provider usage, include 20 tokens for the system prompt, instructions, and tool definition.
    expect(SessionCompaction.estimateContext({ ...grown, messages: [interrupted] })).toBe(21)
    // Another provider's usage is not trusted either.
    const foreign = { ...assistant, model: { ...assistant.model, providerID: Provider.ID.make("other") } }
    expect(SessionCompaction.estimateContext({ ...grown, messages: [foreign] })).toBe(21)
    expect(
      SessionCompaction.estimateContext({
        ...grown,
        messages: [{ ...interrupted, tokens: input(0, contextLimited).messages[0].tokens }],
      }),
    ).toBe(21)

    const media = [
      { type: "file", mime: "image/png", uri: `data:image/png;base64,${"a".repeat(100_000)}` },
      { type: "file", mime: "application/pdf", uri: `data:application/pdf;base64,${"a".repeat(100_000)}` },
    ] as const
    const messages = [
      { ...assistant, content: [{ ...tool, state: { status: "completed" as const, input: {}, content: media } }] },
    ]
    expect(SessionCompaction.estimateContext({ ...grown, messages })).toBe(92_500)
    const user = Schema.decodeUnknownSync(SessionMessage.User)({
      id: SessionMessage.ID.create(),
      type: "user",
      text: "",
      files: media.map((file) => ({ mime: file.mime, data: "a".repeat(100_000), source: { type: "inline" } })),
      time: { created: 0 },
    })
    expect(SessionCompaction.estimateContext({ ...grown, messages: [...messages, user] })).toBe(96_000)
    for (const [modalities, tokens, fallback] of [
      [["text", "image"], 92_040, 1_520],
      [["text", "pdf"], 93_042, 2_021],
      [["text"], 89_082, 41],
    ] as const) {
      const selected = {
        ...grown,
        model: { ...grown.model, capabilities: { ...grown.model.capabilities, input: modalities } },
      }
      expect(SessionCompaction.estimateContext({ ...selected, messages: [...messages, user] })).toBe(tokens)
      expect(SessionCompaction.estimateContext({ ...selected, messages: [user] })).toBe(fallback + 20)
    }

    const checkpoint = Schema.decodeUnknownSync(SessionMessage.CompactionCompleted)({
      id: SessionMessage.ID.create(),
      type: "compaction",
      status: "completed",
      reason: "auto",
      summary: "x".repeat(400_000),
      recent: "",
      time: { created: 0, completed: 0 },
    })
    expect(yield* due({ ...grown, messages: [checkpoint] })).toBe(false)
  }),
)

/** Seeds the global project plus one session row, returning the projected session. */
const insertSession = (id: Session.ID, overrides?: Partial<typeof SessionTable.$inferInsert>) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title: id,
        version: "test",
        ...overrides,
      })
      .run()
      .pipe(Effect.orDie)
    const store = yield* SessionStore.Service
    return yield* store
      .get(id)
      .pipe(Effect.flatMap((session) => (session ? Effect.succeed(session) : Effect.die(`session missing: ${id}`))))
  })

const loaded = (session: Session.Info, messages: readonly SessionMessage.Info[]) => ({
  session,
  messages,
  model: resolved,
  agent: { id: Agent.defaultID, info: Agent.Info.default(Agent.defaultID) },
  initial: "Session instructions",
  tools: { definitions: [], execute: () => Effect.die("Compaction must not execute tools") },
})

/** Opens the compaction's message as the runner does when it delivers `/compact`, then compacts. */
const compactManually = (
  session: Session.Info,
  messages: readonly SessionMessage.Info[],
  inputID = SessionMessage.ID.create(),
) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const compaction = yield* SessionCompaction.Service
    yield* bus.publish(SessionEvent.Compaction.Started, {
      sessionID: session.id,
      reason: "manual",
      recent: "",
      inputID,
    })
    return yield* compaction.compact({ reason: "manual", context: loaded(session, messages), inputID })
  })

/** The recent text a manual compaction keeps when the latest exchange is one tool call with this output. */
const recentWithToolOutput = (id: Session.ID, content: SessionMessage.ToolStateCompleted["content"]) =>
  Effect.gen(function* () {
    const session = yield* insertSession(id)
    const user = (text: string) =>
      SessionMessage.User.make({
        id: SessionMessage.ID.create(),
        type: "user",
        text,
        time: { created: DateTime.makeUnsafe(0) },
      })
    const assistant = Schema.decodeUnknownSync(SessionMessage.Assistant)({
      id: SessionMessage.ID.create(),
      type: "assistant",
      agent: Agent.defaultID,
      model: { id: "summary-model", providerID: "test" },
      content: [
        {
          type: "tool",
          id: "call_read",
          name: "read",
          state: { status: "completed", input: {}, content },
          time: { created: 0 },
        },
      ],
      time: { created: 0, completed: 0 },
    })
    expect(yield* compactManually(session, [user("Earlier question"), user("Read it"), assistant])).toEqual({
      status: "completed",
    })
    const store = yield* SessionStore.Service
    const stored = (yield* store.context(id))[0]
    return stored?.type === "compaction" && stored.status === "completed" ? stored.recent : ""
  })

it.effect("keeps no more than the configured recent user exchanges", () =>
  Effect.gen(function* () {
    const compaction = yield* SessionCompaction.Service
    yield* compaction.transform((editor) => editor.configure({ keep: 1_000, keepTurns: 2 }))
    const id = Session.ID.make("ses_keep_turns")
    const session = yield* insertSession(id)
    const messages = ["Old " + "context ".repeat(20_000), "Second question", "Third question", "Latest question"].map(
      (text, index) =>
        SessionMessage.User.make({
          id: SessionMessage.ID.create(),
          type: "user",
          text,
          time: { created: DateTime.makeUnsafe(index) },
        }),
    )
    expect(yield* compactManually(session, messages)).toEqual({ status: "completed" })
    const store = yield* SessionStore.Service
    const stored = (yield* store.context(id))[0]
    if (stored?.type !== "compaction" || stored.status !== "completed") throw new Error("Expected compaction")
    expect(stored.recent).toContain("Third question")
    expect(stored.recent).toContain("Latest question")
    expect(stored.recent).not.toContain("Second question")
  }),
)

it.effect("manual compaction summarizes short context instead of no-op", () =>
  Effect.gen(function* () {
    requests = []
    const db = (yield* Database.Service).db
    const bus = yield* Bus.Service
    const store = yield* SessionStore.Service
    const sessionID = Session.ID.make("ses_manual_compaction")
    const parentID = Session.ID.make("ses_manual_compaction_parent")
    const userMessage = {
      id: SessionMessage.ID.create(),
      type: "user" as const,
      text: "Manual compaction should include this short conversation.",
      skills: [
        {
          id: Skill.ID.make("effect"),
          name: Skill.Name.make("Effect"),
          text: "Use Effect services and generators.",
        },
      ],
      time: { created: DateTime.makeUnsafe(0) },
    }
    const session = yield* insertSession(sessionID, { parent_id: parentID })
    const hooks = yield* PluginHooks.Service
    let hooked = 0
    yield* hooks.register("session", "compaction", (event) =>
      Effect.sync(() => {
        hooked = event.messages.length
        expect(JSON.stringify(event.messages)).not.toContain("Summarize only what")
      }),
    )
    const messages = [
      userMessage,
      SessionMessage.Shell.make({
        id: SessionMessage.ID.create(),
        type: "shell",
        shellID: Shell.ID.make("sh_background"),
        status: "exited",
        command: "pwd",
        metadata: { background: true },
        output: { output: "display-only-output", cursor: 19, size: 19, truncated: false },
        time: { created: DateTime.makeUnsafe(0), completed: DateTime.makeUnsafe(1) },
      }),
      SessionMessage.Synthetic.make({
        id: SessionMessage.ID.create(),
        type: "synthetic",
        text: "User shell pwd completed: /project",
        time: { created: DateTime.makeUnsafe(2) },
      }),
    ]

    const delta = yield* bus
      .subscribe(SessionEvent.Compaction.Delta)
      .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
    yield* Effect.yieldNow
    expect(yield* compactManually(session, messages, SessionMessage.ID.make("msg_manual_compaction"))).toEqual({
      status: "completed",
    })
    expect(Array.from(yield* Fiber.join(delta)).map((event) => event.data.text)).toEqual([summary])

    expect(requests).toHaveLength(1)
    expect(requests[0]?.promptCacheKey).toBe(parentID)
    expect(requests[0]?.http?.headers).toEqual({
      "x-session-affinity": sessionID,
      "X-Session-Id": sessionID,
      "x-parent-session-id": parentID,
      "User-Agent": App.useragent(App.make()),
      "x-opencode-project": Project.ID.global,
      "x-opencode-session": sessionID,
      "x-opencode-client": "opencode",
    })
    expect(requests[0]?.generation).toEqual(GenerationOptions.make({ maxTokens: 20_000 }))
    expect(JSON.stringify(requests[0]?.messages)).toContain("Manual compaction should include this short conversation.")
    expect(JSON.stringify(requests[0]?.messages)).toContain("Use Effect services and generators.")
    expect(JSON.stringify(requests[0]?.messages)).toContain("User shell pwd completed: /project")
    expect(requests[0]?.messages).toHaveLength(hooked + 1)
    expect(JSON.stringify(requests[0]?.messages.at(-1))).toContain("Summarize only what")
    expect(JSON.stringify(requests[0]?.messages)).not.toContain("display-only-output")
    // The compaction message carries its own request usage so clients can show what compacting cost.
    expect(yield* store.context(sessionID)).toMatchObject([
      {
        type: "compaction",
        reason: "manual",
        summary: expect.stringContaining(summary),
        recent: "",
        cost: 0.0000233,
        tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 2 } },
      },
    ])
    expect(yield* store.get(sessionID)).toMatchObject({
      cost: 0.0000233,
      tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 2 } },
    })
    expect(
      yield* db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie),
    ).toEqual([
      { type: Bus.versionedType(SessionEvent.Compaction.Started.type, 1) },
      { type: Bus.versionedType(SessionEvent.UsageRecorded.type, 1) },
      { type: Bus.versionedType(SessionEvent.Compaction.Ended.type, 1) },
    ])
  }),
)

it.effect("compaction hooks can supply the summary instead of the model", () =>
  Effect.gen(function* () {
    requests = []
    const db = (yield* Database.Service).db
    const hooks = yield* PluginHooks.Service
    const store = yield* SessionStore.Service
    const sessionID = Session.ID.make("ses_hooked_compaction")
    const session = yield* insertSession(sessionID)
    const messages = [
      {
        id: SessionMessage.ID.create(),
        type: "user" as const,
        text: "Hooked compaction should see this conversation.",
        time: { created: DateTime.makeUnsafe(0) },
      },
    ]
    let contexts = 0
    yield* hooks.register("session", "context", () => Effect.sync(() => contexts++))
    yield* hooks.register("session", "compaction", (event) =>
      Effect.sync(() => {
        expect(event.sessionID).toBe(sessionID)
        expect(event.agent).toBe(Agent.defaultID)
        expect(JSON.stringify(event.messages)).toContain("Hooked compaction should see this conversation.")
        event.result = { summary: "## Objective\n- hooked summary" }
      }),
    )

    expect(yield* compactManually(session, messages, SessionMessage.ID.make("msg_hooked_compaction"))).toEqual({
      status: "completed",
    })

    expect(contexts).toBe(0)
    expect(requests).toEqual([])
    expect(yield* store.context(sessionID)).toMatchObject([
      { type: "compaction", reason: "manual", summary: "## Objective\n- hooked summary", recent: "" },
    ])
    expect(
      yield* db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie),
    ).toEqual([
      { type: Bus.versionedType(SessionEvent.Compaction.Started.type, 1) },
      { type: Bus.versionedType(SessionEvent.Compaction.Ended.type, 1) },
    ])
  }),
)

it.effect("native compaction fails without a model call on a route that cannot compact", () =>
  Effect.gen(function* () {
    requests = []
    const compaction = yield* SessionCompaction.Service
    const session = yield* insertSession(Session.ID.make("ses_native_unsupported"))
    const messages = [
      SessionMessage.User.make({
        id: SessionMessage.ID.create(),
        type: "user",
        text: "Compact this natively.",
        time: { created: DateTime.makeUnsafe(0) },
      }),
    ]
    expect(
      yield* compaction.compact({
        reason: "manual",
        context: { ...loaded(session, messages), model: { ...resolved, compaction: { type: "native" } } },
        inputID: SessionMessage.ID.create(),
      }),
    ).toEqual({
      status: "failed",
      error: {
        type: "provider.unsupported-operation",
        message: "Native compaction is not supported for test/openai-chat",
      },
    })
    expect(requests).toHaveLength(0)
  }),
)

it.effect("forked session compaction reuses the fork root prompt cache key", () =>
  Effect.gen(function* () {
    requests = []
    const sessionID = Session.ID.make("ses_fork_compaction")
    const rootID = Session.ID.make("ses_fork_compaction_root")
    const session = yield* insertSession(sessionID, {
      fork_session_id: rootID,
      fork_boundary: { type: "before", messageID: SessionMessage.ID.create() },
    })
    const messages = [
      SessionMessage.User.make({
        id: SessionMessage.ID.create(),
        type: "user",
        text: "Summarize the forked conversation.",
        time: { created: DateTime.makeUnsafe(0) },
      }),
    ]
    expect(yield* compactManually(session, messages, SessionMessage.ID.make("msg_fork_compaction"))).toEqual({
      status: "completed",
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.promptCacheKey).toBe(rootID)
  }),
)

const userRequest = (text: string, created = 0) =>
  SessionMessage.User.make({
    id: SessionMessage.ID.create(),
    type: "user",
    text,
    time: { created: DateTime.makeUnsafe(created) },
  })

/** An assistant reply whose provider count puts the context at `input` tokens. */
const measuredReply = (input: number, text = "Done.") =>
  Schema.decodeUnknownSync(SessionMessage.Assistant)({
    id: SessionMessage.ID.create(),
    type: "assistant",
    agent: Agent.defaultID,
    model: { id: "summary-model", providerID: "test" },
    content: [{ type: "text", text }],
    tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, completed: 1 },
  })

test("the kept tail scales with the usable window unless configured", () => {
  expect(SessionCompaction.tailBudget(180_000)).toBe(18_000)
  expect(SessionCompaction.tailBudget(1_000_000)).toBe(60_000)
  expect(SessionCompaction.tailBudget(40_000)).toBe(8_000)
  // A small window never keeps more than a quarter of itself verbatim.
  expect(SessionCompaction.tailBudget(20_000)).toBe(5_000)
  expect(SessionCompaction.tailBudget(180_000, 1_000)).toBe(1_000)
  expect(SessionCompaction.requestBudget(180_000, 18_000)).toBe(18_000)
  expect(SessionCompaction.requestBudget(40_000, 8_000)).toBe(10_000)
})

test("a text over its budget keeps a head and tail around an elision marker, whatever the script", () => {
  expect(SessionCompaction.elideMiddle("short", 100)).toBe("short")
  const text = "字".repeat(4_000) + "😀".repeat(4_000)
  expect(SessionCompaction.elideMiddle(text, 100)).toBe(
    `${"字".repeat(200)}\n[middle elided: 2850 tokens]\n${"😀".repeat(200)}`,
  )
})

test("the wrap-up reminder is due in the last 5% below the threshold", () => {
  expect(SessionCompaction.wrapUpDue({ used: 94_999, ceiling: 100_000 })).toBe(false)
  expect(SessionCompaction.wrapUpDue({ used: 95_000, ceiling: 100_000 })).toBe(true)
  expect(SessionCompaction.wrapUpDue({ used: 120_000, ceiling: 100_000 })).toBe(true)
  expect(SessionCompaction.wrapUpDue({ used: 1_000_000, ceiling: Number.POSITIVE_INFINITY })).toBe(false)
})

test("background preparation starts only in the band just below the threshold", () => {
  const input = { enabled: true, preparing: false, ceiling: 180_000 }
  expect(SessionCompaction.shouldPrepare({ ...input, estimate: 171_999 })).toBe(false)
  expect(SessionCompaction.shouldPrepare({ ...input, estimate: 172_000 })).toBe(true)
  expect(SessionCompaction.shouldPrepare({ ...input, estimate: 180_000 })).toBe(false)
  expect(SessionCompaction.shouldPrepare({ ...input, estimate: 175_000, preparing: true })).toBe(false)
  expect(SessionCompaction.shouldPrepare({ ...input, estimate: 175_000, enabled: false })).toBe(false)
  // In a small window the band is a tenth of the threshold.
  expect(SessionCompaction.shouldPrepare({ ...input, ceiling: 50_000, estimate: 44_999 })).toBe(false)
  expect(SessionCompaction.shouldPrepare({ ...input, ceiling: 50_000, estimate: 45_000 })).toBe(true)
  expect(SessionCompaction.shouldPrepare({ ...input, ceiling: Number.POSITIVE_INFINITY, estimate: 1e9 })).toBe(false)
})

test("a /compact focus steers the summary prompt", () => {
  expect(SessionCompaction.buildPrompt(false, false, "the failing migration")).toContain(
    "Focus: the failing migration",
  )
  expect(SessionCompaction.buildPrompt(true, false, "the failing migration")).toContain(
    "Focus: the failing migration",
  )
  expect(SessionCompaction.buildPrompt(false)).not.toContain("Focus:")
})

it.effect("a manual compaction's focus reaches the summary request", () =>
  Effect.gen(function* () {
    requests = []
    const bus = yield* Bus.Service
    const compaction = yield* SessionCompaction.Service
    const session = yield* insertSession(Session.ID.make("ses_compaction_focus"))
    const inputID = SessionMessage.ID.create()
    yield* bus.publish(SessionEvent.Compaction.Started, { sessionID: session.id, reason: "manual", recent: "", inputID })
    expect(
      yield* compaction.compact({
        reason: "manual",
        context: loaded(session, [userRequest("First request"), userRequest("Latest request", 1)]),
        inputID,
        focus: "the failing migration",
      }),
    ).toEqual({ status: "completed" })

    expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0]?.messages.at(-1))).toContain("Focus: the failing migration")
  }),
)

// Fake credentials are assembled from parts so no secret scanner mistakes them for real ones.
const fakeKey = "sk-" + "proj-" + "Ab3".repeat(16)
const fakePassword = "hunter" + "2"

it.effect("a pasted key stays out of the summary request and the checkpoint, even when the summary repeats it", () =>
  Effect.gen(function* () {
    requests = []
    const id = Session.ID.make("ses_redacted_checkpoint")
    const session = yield* insertSession(id)
    echo = `\n- The user's key is ${fakeKey}`
    const outcome = yield* compactManually(session, [
      userRequest(`Use OPENAI_API_KEY=${fakeKey} and https://admin:${fakePassword}@db.internal/app`),
      userRequest(`Latest request with ${fakeKey}`, 1),
    ])
    echo = ""
    expect(outcome).toEqual({ status: "completed" })

    expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0]?.messages)).not.toContain(fakeKey)
    expect(JSON.stringify(requests[0]?.messages)).not.toContain(fakePassword)
    const stored = (yield* (yield* SessionStore.Service).context(id))[0]
    if (stored?.type !== "compaction" || stored.status !== "completed") throw new Error("Expected compaction")
    expect(stored.summary).not.toContain(fakeKey)
    expect(stored.summary).not.toContain(fakePassword)
    expect(stored.summary).toContain("The user's key is [redacted:openai-key]")
    expect(stored.summary).toContain("OPENAI_API_KEY=[redacted:openai-key]")
    expect(stored.summary).toContain("https://admin:[redacted:password]@db.internal/app")
    expect(stored.recent).toBe("[User]: Latest request with [redacted:openai-key]")
  }),
)

test("anchors carried forward from an earlier checkpoint lose the secrets it leaked", () => {
  const token = "ghp" + "_" + "A1b".repeat(12)
  const previous = [
    summary,
    "",
    "<session-anchors>",
    "User requests, newest first:",
    `- ${JSON.stringify(`push with ${token}`)}`,
    "",
    "Identifiers from user requests:",
    `- https://ci:${fakePassword}@ci.internal/hook?token=${"abc" + "123"}`,
    "</session-anchors>",
  ].join("\n")
  const anchors = SessionCompaction.buildAnchors([userRequest("Continue")], previous)
  expect(anchors).toContain("Earlier anchors:")
  expect(anchors).toContain("push with [redacted:github-token]")
  expect(anchors).toContain("https://ci:[redacted:password]@ci.internal/hook?token=[redacted:token]")
  expect(anchors).not.toContain(token)
  expect(anchors).not.toContain(fakePassword)
})

test("a checkpoint stored before redaction is redacted as it is sent", () => {
  const [checkpoint] = toLLMMessages(
    [
      SessionMessage.Compaction.make({
        id: SessionMessage.ID.create(),
        type: "compaction",
        status: "completed",
        reason: "auto",
        summary: `${summary}\n- Deploy with OPENAI_API_KEY=${fakeKey}`,
        recent: `[User]: the database password: ${fakePassword}!`,
        time: { created: DateTime.makeUnsafe(0) },
      }),
    ],
    resolved.ref,
  )
  const sent = JSON.stringify(checkpoint?.content)
  expect(sent).not.toContain(fakeKey)
  expect(sent).not.toContain(fakePassword)
  expect(sent).toContain("OPENAI_API_KEY=[redacted:openai-key]")
})

it.effect("a huge latest request stays in the checkpoint as its head and tail", () =>
  Effect.gen(function* () {
    const id = Session.ID.make("ses_huge_request")
    const session = yield* insertSession(id)
    const huge = `HEAD ${"x".repeat(400_000)} TAIL`
    expect(yield* compactManually(session, [userRequest("Earlier request"), userRequest(huge, 1)])).toEqual({
      status: "completed",
    })

    const stored = (yield* (yield* SessionStore.Service).context(id))[0]
    if (stored?.type !== "compaction" || stored.status !== "completed") throw new Error("Expected compaction")
    expect(stored.recent).toStartWith("[User]: HEAD")
    expect(stored.recent).toEndWith("TAIL")
    expect(stored.recent).toMatch(/\n\[middle elided: \d+ tokens\]\n/)
    // The 200k window keeps a request of up to 18k tokens verbatim.
    expect(stored.recent.length).toBeLessThan(18_000 * 4 + 100)
  }),
)

it.effect("an automatic check near the limit leaves a wrap-up reminder while compaction is off", () =>
  Effect.gen(function* () {
    const compaction = yield* SessionCompaction.Service
    yield* compaction.transform((editor) => editor.configure({ auto: false }))
    const session = yield* insertSession(Session.ID.make("ses_wrap_up"))
    const reminder = Instructions.read(compaction.wrapUp(session.id)).pipe(Effect.map((read) => read[0]?.value))
    const check = (input: number) =>
      compaction.compact({ reason: "auto", context: loaded(session, [userRequest("Work"), measuredReply(input)]) })

    expect(yield* check(100_000)).toEqual({ status: "skipped" })
    expect(yield* reminder).toBe(Instructions.removed)
    // The 200k window compacts at 180k, so 95% of it is 171k.
    expect(yield* check(172_000)).toEqual({ status: "skipped" })
    expect(yield* reminder).toBe(SessionCompaction.WRAP_UP)
    // Room freed below the last 5% clears it again.
    expect(yield* check(150_000)).toEqual({ status: "skipped" })
    expect(yield* reminder).toBe(Instructions.removed)
  }),
)

it.effect("no wrap-up reminder while automatic compaction can still run", () =>
  Effect.gen(function* () {
    const compaction = yield* SessionCompaction.Service
    const session = yield* insertSession(Session.ID.make("ses_no_wrap_up"))
    expect(
      yield* compaction.compact({
        reason: "auto",
        context: loaded(session, [userRequest("Work"), measuredReply(172_000)]),
      }),
    ).toEqual({ status: "skipped" })
    expect((yield* Instructions.read(compaction.wrapUp(session.id)))[0]?.value).toBe(Instructions.removed)
  }),
)

it.effect("an automatic compaction commits the summary prepared in the background", () =>
  Effect.gen(function* () {
    requests = []
    const compaction = yield* SessionCompaction.Service
    yield* compaction.transform((editor) => editor.configure({ background: true }))
    const id = Session.ID.make("ses_background_compaction")
    const session = yield* insertSession(id)
    const earlier = [userRequest("First request"), measuredReply(175_000)]

    // 175k is inside the 8k band below the 180k threshold: the summary is prepared, nothing is compacted yet.
    expect(yield* compaction.compact({ reason: "auto", context: loaded(session, earlier) })).toEqual({
      status: "skipped",
    })
    expect((yield* (yield* SessionStore.Service).context(id)).some((message) => message.type === "compaction")).toBe(
      false,
    )

    const later = [...earlier, userRequest("Next request", 2), measuredReply(181_000, "Working on it.")]
    expect(yield* compaction.compact({ reason: "auto", context: loaded(session, later) })).toEqual({
      status: "completed",
    })
    // The prepared summary was the only model call.
    expect(requests).toHaveLength(1)
    const stored = (yield* (yield* SessionStore.Service).context(id))[0]
    if (stored?.type !== "compaction" || stored.status !== "completed") throw new Error("Expected compaction")
    expect(SessionCompaction.stripAnchors(stored.summary)).toBe(summary)
    expect(stored.recent).toContain("[User]: Next request")
    expect(stored.recent).toContain("[Assistant]: Working on it.")
    expect(stored.recent).not.toContain("First request")
  }),
)

it.effect("a summary prepared for a history that changed is written again", () =>
  Effect.gen(function* () {
    requests = []
    const compaction = yield* SessionCompaction.Service
    yield* compaction.transform((editor) => editor.configure({ background: true }))
    const session = yield* insertSession(Session.ID.make("ses_background_stale"))
    const first = userRequest("First request")
    expect(
      yield* compaction.compact({ reason: "auto", context: loaded(session, [first, measuredReply(175_000)]) }),
    ).toEqual({ status: "skipped" })

    const rewritten = [first, measuredReply(175_000, "A different reply."), userRequest("Next request", 2)]
    expect(
      yield* compaction.compact({ reason: "auto", context: loaded(session, [...rewritten, measuredReply(181_000)]) }),
    ).toEqual({ status: "completed" })
    // The stale preparation may or may not have reached the model before it was cancelled; the checkpoint did not
    // use it and summarized the current history instead.
    expect(requests.some((request) => JSON.stringify(request.messages).includes("A different reply."))).toBe(true)
  }),
)
