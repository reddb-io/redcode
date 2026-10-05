import { expect } from "bun:test"
import { LLMClient, LLMEvent, LanguageModel, type LLMRequest } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { llmClient } from "@opencode/core/effect/app-node-platform"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Intelligence, type EvaluationInput } from "@opencode/core/intelligence"
import { IntelligenceClassification } from "@opencode/core/intelligence/classification"
import { SessionCompaction } from "@opencode/core/session/compaction"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionModelRequest } from "@opencode/core/session/model-request"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { Session } from "@opencode/core/session"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { Agent } from "@opencode/core/agent"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { DateTime, Effect, Layer, Stream } from "effect"
import { testEffect } from "./lib/effect"
import { offlineModels } from "./fixture/models"

const summary = (extra: string) =>
  [
    "## Objective",
    "- Continue the user's work.",
    "## Requirements",
    "- Preserve the user's constraints.",
    "## Decisions",
    "- (none)",
    "## Work State",
    "### Completed",
    "- (none)",
    "### Active",
    "- Continue the task.",
    "### Blocked",
    "- (none)",
    "## Next Move",
    "1. Continue from the checkpoint.",
    "## Relevant Files",
    "- (none)",
    "## Important Context",
    `- ${extra}`,
  ].join("\n")

// Prose and keys are assembled from parts so no secret scanner mistakes them for real credentials.
const prose = "banana" + "123"
const key = "sk-" + "proj-" + "Qx5".repeat(16)

let requests: LLMRequest[] = []
/** What each summarizer call answers, in order; the last one repeats. */
let replies: string[] = []
let reviews: EvaluationInput[] = []
/** What S1 answers for each review, in order; undefined stands for an unavailable evaluator. */
let verdicts: Array<number | undefined> = []

const client = Layer.mock(LLMClient.Service)({
  stream: (request: LLMRequest) => {
    requests.push(request)
    const text = replies.length > 1 ? (replies.shift() ?? "") : (replies[0] ?? "")
    return Stream.make(
      LLMEvent.textDelta({ id: "summary", text }),
      LLMEvent.stepFinish({
        index: 0,
        reason: { normalized: "stop" },
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          nonCachedInputTokens: 10,
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 0,
          reasoningTokens: 0,
        },
      }),
      LLMEvent.finish({ reason: { normalized: "stop" } }),
    )
  },
  generate: () => Effect.die("unused"),
})

/** The S1 evaluation record, named through the classification reader so it needs no second `Intelligence` import. */
type Evaluation = NonNullable<Parameters<typeof IntelligenceClassification.restricted>[0]>

const evaluation = (input: EvaluationInput, noul: number): Evaluation => ({
  id: `evaluation-${reviews.length}`,
  fingerprint: "fingerprint",
  sessionID: input.sessionID,
  operation: input.operation,
  kind: "gate",
  attempt: input.attempt,
  policy: "test",
  decision: "inconclusive",
  model: "jev",
  answers: { restricted_content: { type: "noul", noul } },
  issues: [],
  created: 0,
  duration: 0,
  usage: { input_tokens: 0, output_tokens: 0 },
})

const intelligence = Layer.mock(Intelligence.Service, {
  evaluate: (input: EvaluationInput) =>
    Effect.sync((): Evaluation | undefined => {
      reviews.push(input)
      const noul = verdicts.length > 1 ? verdicts.shift() : verdicts[0]
      return noul === undefined ? undefined : evaluation(input, noul)
    }),
})

const resolved = SessionRunnerModel.resolved(
  LanguageModel.make({ id: "summary-model", provider: "test", route: OpenAIChat.route }),
  {
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    cost: [],
    limit: { context: 200_000, output: 32_000 },
  },
)

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
      Intelligence.node.replace(intelligence),
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make(process.cwd()) })),
      offlineModels,
    ],
  ),
)

const insertSession = (id: Session.ID, metadata?: (typeof SessionTable.$inferInsert)["metadata"]) =>
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
        metadata,
      })
      .run()
      .pipe(Effect.orDie)
    const store = yield* SessionStore.Service
    const session = yield* store.get(id)
    return session ?? (yield* Effect.die(`session missing: ${id}`))
  })

const user = (text: string, created = 0) =>
  SessionMessage.User.make({
    id: SessionMessage.ID.create(),
    type: "user",
    text,
    time: { created: DateTime.makeUnsafe(created) },
  })

/** Compacts manually, as the runner does when it delivers `/compact`, and returns the stored checkpoint. */
const compact = (session: Session.Info, messages: readonly SessionMessage.Info[]) =>
  Effect.gen(function* () {
    const inputID = SessionMessage.ID.create()
    const bus = yield* Bus.Service
    const store = yield* SessionStore.Service
    yield* bus.publish(SessionEvent.Compaction.Started, {
      sessionID: session.id,
      reason: "manual",
      recent: "",
      inputID,
    })
    const compaction = yield* SessionCompaction.Service
    const outcome = yield* compaction.compact({
      reason: "manual",
      inputID,
      context: {
        session,
        messages,
        model: resolved,
        agent: { id: Agent.defaultID, info: Agent.Info.default(Agent.defaultID) },
        initial: "Session instructions",
        tools: { definitions: [], execute: () => Effect.die("Compaction must not execute tools") },
      },
    })
    expect(outcome).toEqual({ status: "completed" })
    const stored = (yield* store.context(session.id))[0]
    if (stored?.type !== "compaction" || stored.status !== "completed") throw new Error("Expected a checkpoint")
    return stored
  })

const reset = (input: { replies: string[]; verdicts: Array<number | undefined> }) => {
  requests = []
  reviews = []
  replies = input.replies
  verdicts = input.verdicts
}

it.effect("a checkpoint S1 flags is rewritten once, and S1 reviews it redacted and on its own", () =>
  Effect.gen(function* () {
    reset({
      replies: [summary(`The user's password is ${prose}; deploy with ${key}`), summary("The user gave a password.")],
      verdicts: [0.9, 0.2],
    })
    const session = yield* insertSession(Session.ID.make("ses_restricted_repair"))
    const stored = yield* compact(session, [user("First request"), user("Latest request", 1)])

    expect(requests).toHaveLength(2)
    expect(JSON.stringify(requests[1]?.messages.at(-1))).toContain("A review found that the checkpoint below")
    expect(JSON.stringify(requests[1]?.messages)).not.toContain(key)
    expect(reviews.map((review) => [review.operation, review.attempt])).toEqual([
      ["compaction", 0],
      ["compaction", 1],
    ])
    expect(JSON.stringify(reviews[0]?.candidate)).not.toContain(key)
    expect(JSON.stringify(reviews[0]?.candidate)).toContain("[redacted:openai-key]")
    expect(JSON.stringify(reviews[0]?.sources)).toBe("[]")
    expect(stored.summary).toContain("The user gave a password.")
    expect(stored.summary).not.toContain(prose)
  }),
)

it.effect("a rewrite S1 flags again is kept only through the pattern redaction", () =>
  Effect.gen(function* () {
    reset({
      replies: [summary(`Deploy with ${key}`), summary(`Still deploy with OPENAI_API_KEY=${key}`)],
      verdicts: [0.95],
    })
    const session = yield* insertSession(Session.ID.make("ses_restricted_twice"))
    const stored = yield* compact(session, [user("First request"), user("Latest request", 1)])

    expect(requests).toHaveLength(2)
    expect(reviews).toHaveLength(2)
    expect(stored.summary).not.toContain(key)
    expect(stored.summary).toContain("OPENAI_API_KEY=[redacted:openai-key]")
  }),
)

it.effect("an unavailable or unsure review neither approves nor blocks the checkpoint", () =>
  Effect.gen(function* () {
    for (const [index, verdict] of [undefined, 0.6, 0.3].entries()) {
      reset({ replies: [summary("Carry on.")], verdicts: [verdict] })
      const session = yield* insertSession(Session.ID.make(`ses_restricted_review_${index}`))
      const stored = yield* compact(session, [user("First request"), user("Latest request", 1)])
      expect(requests).toHaveLength(1)
      expect(reviews).toHaveLength(1)
      expect(stored.summary).toContain("Carry on.")
    }
  }),
)

it.effect("a restricted message reaches neither the summarizer, the anchors nor the recent context", () =>
  Effect.gen(function* () {
    reset({ replies: [summary("Carry on.")], verdicts: [undefined] })
    const older = user(`a senha do servidor é ${prose}`)
    const latest = user(`e o token é ${prose}`, 1)
    const session = yield* insertSession(Session.ID.make("ses_restricted_marked"), {
      restricted: { [older.id]: "sensitive", [latest.id]: "withheld" },
    })
    const stored = yield* compact(session, [older, user("Keep going with the migration", 1), latest])

    expect(JSON.stringify(requests[0]?.messages)).not.toContain(prose)
    expect(stored.summary).not.toContain(prose)
    expect(stored.recent).not.toContain(prose)
    expect(`${stored.summary}\n${stored.recent}`).toContain("Keep going with the migration")
  }),
)
