import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema, Stream } from "effect"
import { LLMClient, LLMEvent, Model, type LLMClientShape, type LLMRequest } from "@reddb-io/redcode-llm"
import * as OpenAIChat from "@reddb-io/redcode-llm/protocols/openai-chat"
import type { Hook } from "@reddb-io/redcode-schema/hook"
import { AgentV2 } from "@reddb-io/redcode-core/agent"
import { Catalog } from "@reddb-io/redcode-core/catalog"
import { Config } from "@reddb-io/redcode-core/config"
import { Database } from "@reddb-io/redcode-core/database/database"
import { makeLocationNode } from "@reddb-io/redcode-core/effect/app-node"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNodePlatform } from "@reddb-io/redcode-core/effect/app-node-platform"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { HookV2 } from "@reddb-io/redcode-core/hook"
import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { Location } from "@reddb-io/redcode-core/location"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import { ModelLimit } from "@reddb-io/redcode-core/model-limit"
import { PermissionV2 } from "@reddb-io/redcode-core/permission"
import { ProjectV2 } from "@reddb-io/redcode-core/project"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { ReferenceGuidance } from "@reddb-io/redcode-core/reference/guidance"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { SessionV2 } from "@reddb-io/redcode-core/session"
import { SessionExecution } from "@reddb-io/redcode-core/session/execution"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { SessionRunCoordinator } from "@reddb-io/redcode-core/session/run-coordinator"
import { SessionRunner } from "@reddb-io/redcode-core/session/runner"
import * as SessionRunnerLLM from "@reddb-io/redcode-core/session/runner/llm"
import { SessionRunnerModel } from "@reddb-io/redcode-core/session/runner/model"
import { SessionTable } from "@reddb-io/redcode-core/session/sql"
import { SessionStore } from "@reddb-io/redcode-core/session/store"
import { SubagentReview } from "@reddb-io/redcode-core/session/subagent-review"
import { SkillGuidance } from "@reddb-io/redcode-core/skill/guidance"
import { Snapshot } from "@reddb-io/redcode-core/snapshot"
import { SystemContext } from "@reddb-io/redcode-core/system-context"
import { TaskTool } from "@reddb-io/redcode-core/tool/task"
import { ToolRegistry } from "@reddb-io/redcode-core/tool/registry"
import { Tool } from "@reddb-io/redcode-core/tool/tool"
import { SessionMessage } from "@reddb-io/redcode-core/session/message"
import { settleTool } from "./lib/tool"
import { testEffect } from "./lib/effect"

// The provider answers every turn, parent's and child's, from one queue in call order.
let responses: LLMEvent[][] = []
const requests: LLMRequest[] = []
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      return Stream.fromIterable(responses.shift() ?? [])
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })

type Evaluation = NonNullable<Effect.Success<ReturnType<Intelligence.Interface["evaluate"]>>>
let reasoning: "single" | "dual" = "dual"
let evaluations: Evaluation[] = []
let inputs: Intelligence.EvaluationInput[] = []
let judge: (input: Intelligence.EvaluationInput) => Evaluation | undefined = () => undefined
const evaluated = (
  input: Intelligence.EvaluationInput,
  decision: Evaluation["decision"],
  answers: Evaluation["answers"] = {},
  issues: string[] = [],
): Evaluation => ({
  id: `evaluation-${evaluations.length + 1}`,
  fingerprint: Intelligence.evaluationFingerprint(input, {
    evaluator: { transport: "typesafe", baseURL: "https://system-one.test/v1", model: "jev-test" },
  }),
  sessionID: input.sessionID,
  operation: input.operation,
  kind: input.kind ?? "gate",
  ...(input.subjectID ? { subjectID: input.subjectID } : {}),
  ...(input.candidateID ? { candidateID: input.candidateID } : {}),
  attempt: input.attempt ?? 0,
  policy: Intelligence.POLICY,
  decision,
  model: "jev-test",
  answers,
  issues,
  created: Date.now(),
  duration: 1,
  usage: { input_tokens: 1, output_tokens: 1 },
})
/** Gates pass unless a test says otherwise; classifications and response reviews stay silent. */
const accepting = (input: Intelligence.EvaluationInput) =>
  input.kind === "classification" || input.operation === "response_quality" || input.operation === "tool_usage"
    ? undefined
    : evaluated(input, "accepted")
const intelligence = Layer.mock(Intelligence.Service, {
  environment: "test",
  read: () =>
    Effect.sync(() => ({
      enabled: true,
      reasoning,
      onboarding: "completed" as const,
      principal: { providerID: ProviderV2.ID.make("fake"), id: ModelV2.ID.make("fake-model") },
      evaluator: { transport: "typesafe" as const, baseURL: "https://system-one.test/v1", model: "jev-test" },
    })),
  evaluate: (input) =>
    Effect.sync(() => {
      inputs.push(input)
      const evaluation = judge(input)
      if (evaluation) evaluations.push(evaluation)
      return evaluation
    }),
  history: (id, options = {}) =>
    Effect.sync(() =>
      evaluations
        .filter((evaluation) => !id || evaluation.sessionID === id)
        .filter((evaluation) => !options.operation || evaluation.operation === options.operation)
        .filter((evaluation) => !options.decision || evaluation.decision === options.decision)
        .filter((evaluation) => !options.subjectID || evaluation.subjectID === options.subjectID)
        .filter((evaluation) => !options.candidateID || evaluation.candidateID === options.candidateID)
        .toReversed(),
    ),
  generation: () => Effect.void,
  router: () => Effect.succeed(undefined),
})

let hookCalls: Array<Omit<Hook.Input, "cwd">> = []
let hookOutput: (input: Omit<Hook.Input, "cwd">) => Hook.Output = () => ({ continue: true })
const hooks = Layer.mock(HookV2.Service, {
  run: (input) =>
    Effect.sync(() => {
      hookCalls.push(input)
      return hookOutput(input)
    }),
})

const variant = (id: string) => ({ id: ModelV2.VariantID.make(id), headers: {}, body: {} })
const catalogModels = [
  { ...ModelV2.Info.empty(ProviderV2.ID.make("fake"), ModelV2.ID.make("fake-model")), variants: [variant("low")] },
  { ...ModelV2.Info.empty(ProviderV2.ID.make("other"), ModelV2.ID.make("big")), variants: [variant("high")] },
]
const catalog = Layer.mock(Catalog.Service, {
  provider: {
    get: () => Effect.succeed(undefined),
    all: () => Effect.succeed([]),
    available: () => Effect.succeed([]),
  },
  model: {
    get: (providerID, modelID) =>
      Effect.succeed(catalogModels.find((item) => item.providerID === providerID && item.id === modelID)),
    all: () => Effect.succeed(catalogModels),
    available: () => Effect.succeed(catalogModels),
    default: () => Effect.succeed(catalogModels[0]),
    small: () => Effect.succeed(undefined),
  },
})

const permission = Layer.mock(PermissionV2.Service, {
  assert: () => Effect.void,
  rules: () => Effect.succeed([]),
})
const projects = Layer.mock(ProjectV2.Service, {
  resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
  directories: () => Effect.succeed([]),
  commit: () => Effect.void,
})
const config = Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed([]) }))
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const modelLimits = ModelLimit.memoryLayer()

const echo = Layer.effectDiscard(
  ToolRegistry.Service.use((registry) =>
    registry.register({
      echo: Tool.make({
        description: "Echo text",
        input: Schema.Struct({ text: Schema.String, variant: Schema.String.pipe(Schema.optional) }),
        output: Schema.Struct({ text: Schema.String }),
        toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
        execute: ({ text }) => Effect.succeed({ text }),
      }),
    }),
  ),
)
const echoNode = makeLocationNode({ name: "test/tool-task-echo", layer: echo, deps: [ToolRegistry.node] })

const overrides: LayerNode.Replacements = [
  [LayerNodePlatform.llmClient, client],
  [ModelLimit.node, modelLimits],
  [PermissionV2.node, permission],
  [SessionRunnerModel.node, SessionRunnerModel.layerWith(() => Effect.succeed(model))],
  [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
  [SkillGuidance.node, skillGuidance],
  [ReferenceGuidance.node, referenceGuidance],
  [Snapshot.node, Snapshot.noopLayer],
  [Config.node, config],
  [Intelligence.node, intelligence],
  [HookV2.node, hooks],
  [Catalog.node, catalog],
  [ProjectV2.node, projects],
]
const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, overrides)
const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const runner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => runner.run({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
    })
  }),
).pipe(Layer.provide(runnerLayer))
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      AgentV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      echoNode,
      TaskTool.node,
      SessionRunnerLLM.node,
      SessionExecution.node,
      SessionV2.node,
    ]),
    [...overrides, [SessionExecution.node, execution]],
  ),
)

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const brief = {
  description: "Summarize the parser",
  prompt: "Read packages/core/src/parser.ts and explain how tokens become syntax nodes, with file references.",
  subagent_type: "general",
  done_criteria: ["every stage of the parser is explained"],
  return_format: "a short list of stages, each with a file:line reference",
}

const text = (id: string, value: string) => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id }),
  LLMEvent.textDelta({ id, text: value }),
  LLMEvent.textEnd({ id }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

/** A fresh parent Session with the build and general agents; every test starts from here. */
const setup = Effect.gen(function* () {
  responses = []
  requests.length = 0
  reasoning = "dual"
  evaluations = []
  inputs = []
  judge = accepting
  hookCalls = []
  hookOutput = () => ({ continue: true })
  const agents = yield* AgentV2.Service
  yield* agents.transform((editor) => {
    editor.update(AgentV2.ID.make("build"), (agent) => {
      agent.mode = "primary"
    })
    editor.update(AgentV2.ID.make("general"), (agent) => {
      agent.mode = "subagent"
      agent.description = "General-purpose agent"
      // Read-only, so a brief needs no scope; the echo tool stays available.
      agent.permissions.push(
        { action: "*", resource: "*", effect: "allow" },
        { action: "edit", resource: "*", effect: "deny" },
        { action: "bash", resource: "*", effect: "deny" },
      )
    })
    editor.update(AgentV2.ID.make("pinned"), (agent) => {
      agent.mode = "subagent"
      agent.model = { id: ModelV2.ID.make("big"), providerID: ProviderV2.ID.make("other") }
      agent.permissions.push(
        { action: "edit", resource: "*", effect: "deny" },
        { action: "bash", resource: "*", effect: "deny" },
      )
    })
  })
  const sessions = yield* SessionV2.Service
  return yield* sessions.create({
    location,
    agent: AgentV2.ID.make("build"),
    model: { id: ModelV2.ID.make("fake-model"), providerID: ProviderV2.ID.make("fake") },
  })
})

const callTask = (parent: SessionV2.ID, input: Record<string, unknown>) =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    return yield* settleTool(registry, {
      sessionID: parent,
      agent: AgentV2.ID.make("build"),
      assistantMessageID: SessionMessage.ID.create(),
      call: { type: "tool-call", id: `call_${crypto.randomUUID()}`, name: "task", input },
    })
  })

const outputOf = (settlement: ToolRegistry.Settlement) =>
  settlement.output?.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n") ?? ""
const errorOf = (settlement: ToolRegistry.Settlement) =>
  settlement.result.type === "error" ? String(settlement.result.value) : ""
const metadataOf = (settlement: ToolRegistry.Settlement) =>
  Schema.decodeUnknownSync(TaskTool.Output)(settlement.output?.structured).metadata

const children = (parent: SessionV2.ID) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    return yield* database.db
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.parent_id, parent))
      .all()
      .pipe(Effect.orDie)
  })

describe("V2 task tool", () => {
  it.live("a brief S1 rejects fails the call; the revised brief launches a child of the caller", () =>
    Effect.gen(function* () {
      const parent = yield* setup
      let briefs = 0
      judge = (input) =>
        input.operation === "subagent_brief"
          ? briefs++ === 0
            ? evaluated(input, "needs_revision", {}, ["missing_context"])
            : evaluated(input, "accepted")
          : accepting(input)

      const rejected = yield* callTask(parent.id, brief)
      expect(errorOf(rejected)).toContain("The brief for the general subagent needs revision")
      expect(errorOf(rejected)).toContain("nothing was launched")
      expect(yield* children(parent.id)).toHaveLength(0)

      responses = [text("child-1", "Stage one lexes tokens (parser.ts:10); stage two builds nodes (parser.ts:40).")]
      const launched = yield* callTask(parent.id, {
        ...brief,
        prompt: `${brief.prompt} Start at the tokenize function.`,
      })
      expect(errorOf(launched)).toBe("")
      const metadata = metadataOf(launched)
      expect(metadata.brief?.verdict).toBe("verified")
      expect(outputOf(launched)).toContain(`<task id="${metadata.sessionId}" state="completed">`)
      expect(outputOf(launched)).toContain("Stage one lexes tokens")

      const store = yield* SessionStore.Service
      const child = yield* store.get(SessionV2.ID.make(metadata.sessionId))
      expect(child?.parentID).toBe(parent.id)
      expect(child?.location).toEqual(parent.location)
      expect(child?.agent).toBe(AgentV2.ID.make("general"))
      // The child keeps the parent's denies and may not start subagents of its own.
      expect(yield* store.permission(SessionV2.ID.make(metadata.sessionId))).toContainEqual({
        action: "task",
        resource: "*",
        effect: "deny",
      })
      expect(
        SubagentReview.fromMetadata(yield* store.metadata(SessionV2.ID.make(metadata.sessionId)))?.criteria,
      ).toEqual(brief.done_criteria)
    }),
  )

  it.live("a result that needs revision gets one repair round, then the verdict", () =>
    Effect.gen(function* () {
      const parent = yield* setup
      let results = 0
      judge = (input) =>
        input.operation === "subagent_result"
          ? results++ === 0
            ? evaluated(input, "needs_revision", {}, ["unmet_criterion"])
            : evaluated(input, "accepted")
          : accepting(input)
      responses = [
        text("first", "The parser has stages."),
        text("second", "Every stage of the parser is explained: lexing (parser.ts:10), building (parser.ts:40)."),
      ]

      const settlement = yield* callTask(parent.id, brief)
      expect(errorOf(settlement)).toBe("")
      expect(results).toBe(2)
      expect(metadataOf(settlement).review).toEqual({ decision: "verified", issues: [], repaired: true })
      expect(outputOf(settlement)).toContain(`<review decision="verified" repaired="true">`)
      expect(outputOf(settlement)).toContain("Every stage of the parser is explained")

      const sessions = yield* SessionV2.Service
      const users = (yield* sessions.context(SessionV2.ID.make(metadataOf(settlement).sessionId))).filter(
        (message) => message.type === "user",
      )
      expect(users).toHaveLength(2)
      expect(users[1]?.type === "user" ? users[1].text : "").toStartWith(SubagentReview.REPAIR)
    }),
  )

  it.live("single reasoning checks structure only and asks S1 nothing", () =>
    Effect.gen(function* () {
      const parent = yield* setup
      reasoning = "single"
      responses = [text("single", "Lexing and building, see parser.ts:10 and parser.ts:40.")]

      const settlement = yield* callTask(parent.id, brief)
      expect(errorOf(settlement)).toBe("")
      expect(metadataOf(settlement).brief?.verdict).toBe("unverified")
      expect(metadataOf(settlement).review?.decision).toBe("unverified")
      expect(inputs.filter((input) => input.operation.startsWith("subagent_"))).toHaveLength(0)
      expect(evaluations).toHaveLength(0)
    }),
  )

  it.live("the model comes from the call, else the agent, else the parent", () =>
    Effect.gen(function* () {
      const parent = yield* setup
      const store = yield* SessionStore.Service
      responses = [text("a", "Done: parser.ts:10."), text("b", "Done: parser.ts:10."), text("c", "Done: parser.ts:10.")]

      const explicit = metadataOf(yield* callTask(parent.id, { ...brief, model: "other/big", variant: "high" }))
      expect(explicit).toMatchObject({ modelSource: "explicit", model: { providerID: "other", modelID: "big" } })
      expect(explicit.variant).toBe("high")
      expect((yield* store.get(SessionV2.ID.make(explicit.sessionId)))?.model).toMatchObject({
        id: "big",
        providerID: "other",
        variant: "high",
      })

      const agent = metadataOf(yield* callTask(parent.id, { ...brief, subagent_type: "pinned" }))
      expect(agent).toMatchObject({ modelSource: "agent", model: { providerID: "other", modelID: "big" } })

      const inherited = metadataOf(yield* callTask(parent.id, brief))
      expect(inherited).toMatchObject({ modelSource: "parent", model: { providerID: "fake", modelID: "fake-model" } })

      expect(errorOf(yield* callTask(parent.id, { ...brief, model: "nope/missing" }))).toContain(
        'Unknown model "nope/missing"',
      )
      expect(errorOf(yield* callTask(parent.id, { ...brief, model: "other/big", variant: "max" }))).toContain(
        'Variant "max" is not available for other/big',
      )
    }),
  )

  it.live("SubagentStart and SubagentStop hooks fire with the subagent's payload", () =>
    Effect.gen(function* () {
      const parent = yield* setup
      hookOutput = (input) =>
        input.event === "SubagentStart"
          ? { continue: true, additionalContext: "Hook context: prefer tables." }
          : { continue: true }
      responses = [text("hooked", "Every stage of the parser is explained at parser.ts:10.")]

      const settlement = yield* callTask(parent.id, brief)
      const childID = metadataOf(settlement).sessionId
      expect(hookCalls.find((input) => input.event === "SubagentStart")).toEqual({
        event: "SubagentStart",
        matcher: "general",
        session_id: parent.id,
        agent_id: childID,
        agent_type: "general",
      })
      expect(hookCalls.find((input) => input.event === "SubagentStop")).toMatchObject({
        event: "SubagentStop",
        matcher: "general",
        session_id: parent.id,
        agent_id: childID,
        agent_type: "general",
        last_assistant_message: "Every stage of the parser is explained at parser.ts:10.",
      })
      const sessions = yield* SessionV2.Service
      const prompt = (yield* sessions.context(SessionV2.ID.make(childID))).find((message) => message.type === "user")
      expect(prompt?.type === "user" ? prompt.text : "").toContain("Hook context: prefer tables.")
    }),
  )

  it.live("a child the stop-loss stops returns the reason, unreviewed", () =>
    Effect.gen(function* () {
      const parent = yield* setup
      const choice = (value: string) => ({
        type: "choice" as const,
        choice: value,
        confidence: 0.9,
        probabilities: { [value]: 0.9, continue: 0.1 },
      })
      judge = (input) =>
        input.operation === "session_progress"
          ? evaluated(input, "accepted", { state: choice("looping"), decision: choice("stop") })
          : accepting(input)
      // The same answer to a probe whose arguments drift, until the stop-loss ends the child.
      responses = Array.from({ length: 6 }, (_, index) => [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({
          id: `call-probe-${index}`,
          name: "echo",
          input: { text: "no devices", variant: `${index}` },
        }),
        LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
        LLMEvent.finish({ reason: "tool-calls" }),
      ])

      const settlement = yield* callTask(parent.id, brief)
      expect(errorOf(settlement)).toBe("")
      expect(metadataOf(settlement).stopped).toBe(true)
      expect(metadataOf(settlement).review).toBeUndefined()
      expect(outputOf(settlement)).toContain("Stopped by the stop-loss before finishing")
      expect(inputs.filter((input) => input.operation === "subagent_result")).toHaveLength(0)
    }),
  )
})

describe("derivePermission", () => {
  const subagent = (permissions: PermissionV2.Ruleset) => ({
    ...AgentV2.Info.empty(AgentV2.ID.make("sub")),
    permissions,
  })

  test("keeps the parent's denies and external directories, and denies task and todowrite by default", () => {
    const parent: PermissionV2.Ruleset = [
      { action: "read", resource: "*", effect: "allow" },
      { action: "webfetch", resource: "*", effect: "deny" },
      { action: "external_directory", resource: "/tmp/*", effect: "allow" },
    ]
    expect(TaskTool.derivePermission({ parent, subagent: subagent([]) })).toEqual([
      { action: "webfetch", resource: "*", effect: "deny" },
      { action: "external_directory", resource: "/tmp/*", effect: "allow" },
      { action: "todowrite", resource: "*", effect: "deny" },
      { action: "task", resource: "*", effect: "deny" },
    ])
    expect(
      TaskTool.derivePermission({
        parent: [],
        subagent: subagent([
          { action: "task", resource: "*", effect: "allow" },
          { action: "todowrite", resource: "*", effect: "allow" },
        ]),
      }),
    ).toEqual([])
  })
})
