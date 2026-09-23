import { Intelligence } from "../src/intelligence"
import { Semantic } from "../src/semantic"
import { AgentV2 } from "../src/agent"
import { expect } from "bun:test"
import path from "node:path"
import { createHash } from "node:crypto"
import { Effect, Layer } from "effect"
import { Model } from "@reddb-io/redcode-llm"
import { ModelV2 } from "../src/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import { OpenAIChat } from "@reddb-io/redcode-llm/protocols/openai-chat"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Database } from "../src/database/database"
import { Location } from "../src/location"
import { PermissionV2 } from "../src/permission"
import { QuestionV2 } from "../src/question"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { SessionSchema } from "../src/session/schema"
import { SessionTable } from "../src/session/sql"
import { SessionGoal } from "../src/session/goal"
import { SessionGoalCompletion } from "../src/session/goal-completion"
import { SessionPlan } from "../src/session/plan"
import { SessionTodo } from "../src/session/todo"
import { SessionInput } from "../src/session/input"
import { SessionMessage } from "../src/session/message"
import { SessionProjector } from "../src/session/projector"
import { Prompt } from "../src/session/prompt"
import { EventV2 } from "../src/event"
import { SessionRunnerModel } from "../src/session/runner/model"
import { GoalTools } from "../src/tool/goal"
import { PlanTools } from "../src/tool/plan"
import { ExternalTools } from "../src/tool/external"
import { DesignTools } from "../src/tool/design"
import { DesignStore } from "../src/design/store"
import { DesignTarget } from "../src/design/target"
import { ToolRegistry } from "../src/tool/registry"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"

const requests: Intelligence.EvaluationInput[] = []
const classifications: Intelligence.EvaluationInput[] = []
const questions: QuestionV2.AskInput[] = []
const assertions: string[] = []
let review = "PASS\nVerified"
let configured = true
let reasoning: "single" | "dual" = "dual"
let duringReview = Effect.void
let duringApproval = Effect.void
let duringTasks = Effect.void
let taskDecision: Intelligence.Evaluation["decision"] = "accepted"
let deny = ""
let answer = "Execute"
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.suspend(() => {
        assertions.push(input.action)
        return input.action === deny ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void
      }),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
    rules: () => Effect.die("unused"),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      GoalTools.node,
      PlanTools.node,
      ExternalTools.node,
      DesignTools.node,
      DesignStore.node,
      ToolRegistry.node,
      Database.node,
      Location.node,
      SessionGoal.node,
      SessionGoalCompletion.node,
      SessionPlan.node,
      SessionTodo.node,
      SessionProjector.node,
      EventV2.node,
    ]),
    [
      [Location.node, tempLocationLayer],
      [Semantic.node, Layer.mock(Semantic.Service, { transform: (input) => input.decode(JSON.stringify(planTasks)) })],
      [PermissionV2.node, permission],
      [
        QuestionV2.node,
        Layer.succeed(
          QuestionV2.Service,
          QuestionV2.Service.of({
            ask: (input) =>
              Effect.gen(function* () {
                questions.push(input)
                yield* duringApproval
                return [[answer]]
              }),
            reply: () => Effect.die("unused"),
            reject: () => Effect.die("unused"),
            list: () => Effect.die("unused"),
          }),
        ),
      ],
      [
        SessionRunnerModel.node,
        SessionRunnerModel.layerWith(() =>
          Effect.succeed(Model.make({ id: "review", provider: "fixture", route: OpenAIChat.route })),
        ),
      ],
      [
        Intelligence.node,
        Layer.mock(Intelligence.Service, {
          environment: "fixture",
          read: () =>
            Effect.sync(() => ({
              enabled: configured,
              reasoning,
              onboarding: "completed",
              principal: { providerID: Provider.ID.make("fixture"), id: ModelV2.ID.make("principal") },
              evaluator: { transport: "typesafe", baseURL: "http://localhost/v1", model: "jev" },
            })),
          history: () => Effect.succeed([]),
          // Mirrors the real service: single reasoning never produces an S1 record.
          evaluate: (input) =>
            Effect.gen(function* () {
              if (reasoning === "single") return undefined
              if (input.operation === "design_target") {
                classifications.push(input)
                return {
                  id: crypto.randomUUID(),
                  fingerprint: "fixture",
                  sessionID: input.sessionID,
                  operation: input.operation,
                  kind: "classification" as const,
                  policy: "fixture",
                  decision: "accepted" as const,
                  model: "jev",
                  answers: {
                    target: {
                      type: "choice" as const,
                      choice: "presentation",
                      probabilities: { web: 0.1, app: 0, presentation: 0.9 },
                      confidence: 0.9,
                    },
                    platform: {
                      type: "choice" as const,
                      choice: "either",
                      probabilities: { ios: 0, android: 0, either: 1 },
                      confidence: 1,
                    },
                  },
                  issues: [],
                  created: Date.now(),
                  duration: 1,
                  usage: { input_tokens: 10, output_tokens: 5 },
                }
              }
              if (input.operation === "goal_completion" || input.operation === "plan") {
                requests.push(input)
                yield* duringReview
              }
              if (input.operation === "task_quality") yield* duringTasks
              return {
                id: crypto.randomUUID(),
                fingerprint: "fixture",
                sessionID: input.sessionID,
                operation: input.operation,
                policy: "fixture",
                decision:
                  input.operation === "task_quality"
                    ? taskDecision
                    : review.startsWith("PASS")
                      ? "accepted"
                      : "needs_revision",
                model: "jev",
                answers: {},
                issues: review.startsWith("PASS") ? [] : [review],
                created: Date.now(),
                duration: 1,
                usage: { input_tokens: 10, output_tokens: 5 },
              }
            }),
        }),
      ],
    ],
  ),
)

const planTasks = [
  {
    key: "button",
    content: "Change and verify the button label",
    criterion: "Chromium shows the new label",
    quote: "Change the button label.",
  },
]

const setup = Effect.gen(function* () {
  configured = true
  reasoning = "dual"
  requests.length = 0
  questions.length = 0
  assertions.length = 0
  review = "PASS\nVerified"
  duringReview = Effect.void
  duringApproval = Effect.void
  duringTasks = Effect.void
  taskDecision = "accepted"
  deny = ""
  answer = "Execute"
  const database = yield* Database.Service
  const location = yield* Location.Service
  const sessionID = SessionSchema.ID.make(`ses_${crypto.randomUUID()}`)
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: location.directory, sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* database.db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      directory: location.directory,
      title: "Goal tools",
      slug: "goal-tools",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  const file = path.join(location.directory, "plan.md")
  yield* Effect.promise(() => Bun.write(file, "# Plan\nChange the button label. Verify it in Chromium."))
  const registry = yield* ToolRegistry.Service
  return {
    sessionID,
    file,
    run: (name: string, input: unknown, agent = toolIdentity.agent) =>
      executeTool(registry, {
        sessionID,
        ...toolIdentity,
        agent,
        call: { type: "tool-call", id: `call_${crypto.randomUUID()}`, name, input },
      }),
  }
})

it.live("completion reads real artifacts and executes gates before a bounded review", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const goals = yield* SessionGoal.Service
    yield* goals.start(test.sessionID, { objective: "Record a plan", gates: ["test -s plan.md"] })
    expect((yield* test.run("goal_complete", { evidence: [test.file], explanation: "Plan is ready" })).type).not.toBe(
      "error",
    )
    expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0].sources)).toContain('"exitCode":0')
    expect(JSON.stringify(requests[0].sources)).toContain("# Plan")
    expect(requests[0].operation).toBe("goal_completion")
    expect(requests[0].questions).toHaveProperty("objective")
    expect((yield* goals.get(test.sessionID))?.status).toBe("active")
    const completion = yield* SessionGoalCompletion.Service
    yield* completion.settle(test.sessionID)
    const goal = yield* goals.get(test.sessionID)
    expect(goal?.status).toBe("done")
    expect(goal?.evidence[0].hash).toHaveLength(64)
    expect(goal?.tokens).toBe(15)
  }),
)

it.live("missing evidence or a failing gate cannot reach the reviewer", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const goals = yield* SessionGoal.Service
    yield* goals.start(test.sessionID, { objective: "Run the check", gates: ["exit 7"] })
    expect((yield* test.run("goal_complete", { evidence: [test.file + ".missing"], explanation: "Done" })).type).toBe(
      "error",
    )
    expect((yield* test.run("goal_complete", { evidence: [test.file], explanation: "Done" })).type).toBe("error")
    expect(requests).toHaveLength(0)
    expect((yield* goals.get(test.sessionID))?.status).toBe("active")
  }),
)

it.live("disabling S1 during goal review or before settlement preserves the active goal", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const goals = yield* SessionGoal.Service
    const completion = yield* SessionGoalCompletion.Service
    yield* goals.start(test.sessionID, { objective: "Record a plan" })
    duringReview = Effect.sync(() => {
      configured = false
    })
    expect((yield* test.run("goal_complete", { evidence: [test.file], explanation: "Ready" })).type).toBe("error")
    expect((yield* goals.get(test.sessionID))?.status).toBe("active")
    configured = true
    duringReview = Effect.void
    expect((yield* test.run("goal_complete", { evidence: [test.file], explanation: "Ready" })).type).not.toBe("error")
    configured = false
    expect((yield* completion.settle(test.sessionID).pipe(Effect.result))._tag).toBe("Failure")
    expect((yield* goals.get(test.sessionID))?.status).toBe("active")
  }),
)

it.live("disabling S1 during plan evaluation or approval cannot authorize Build", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const plans = yield* SessionPlan.Service
    duringReview = Effect.sync(() => {
      configured = false
    })
    expect((yield* test.run("plan_exit", { path: test.file, tasks: planTasks })).type).toBe("error")
    expect(yield* plans.list(test.sessionID)).toEqual([])
    configured = true
    duringReview = Effect.void
    duringApproval = Effect.sync(() => {
      configured = false
    })
    expect((yield* test.run("plan_exit", { path: test.file, tasks: planTasks })).type).toBe("error")
    expect((yield* plans.list(test.sessionID)).every((plan) => plan.status === "ready")).toBe(true)
    const todos = yield* SessionTodo.Service
    expect(yield* todos.get(test.sessionID)).toEqual([])
  }),
)

it.live("single reasoning completes goals and plans through gates and structural checks, reported as unverified", () =>
  Effect.gen(function* () {
    const test = yield* setup
    reasoning = "single"
    const goals = yield* SessionGoal.Service
    const plans = yield* SessionPlan.Service
    const completion = yield* SessionGoalCompletion.Service
    yield* goals.start(test.sessionID, { objective: "Run the check", gates: ["exit 7"] })
    expect((yield* test.run("goal_complete", { evidence: [test.file], explanation: "Done" })).type).toBe("error")
    expect((yield* goals.get(test.sessionID))?.status).toBe("active")
    const goal = yield* goals.get(test.sessionID)
    yield* goals.save(goal!, { ...goal!, gates: ["test -s plan.md"] })
    expect((yield* test.run("goal_complete", { evidence: [test.file], explanation: "Plan is ready" })).type).not.toBe(
      "error",
    )
    const done = yield* completion.settle(test.sessionID)
    expect(done?.status).toBe("done")
    expect(done?.reason).toContain(Intelligence.UNVERIFIED)
    expect(done?.checks[0]).toMatchObject({ command: "test -s plan.md", exitCode: 0 })
    expect(
      (yield* test.run("plan_exit", { path: test.file, tasks: [{ ...planTasks[0], quote: "Nowhere" }] })).type,
    ).toBe("error")
    expect((yield* test.run("plan_exit", { path: test.file, tasks: planTasks })).type).not.toBe("error")
    expect(questions.at(-1)?.questions[0].question).toContain(Intelligence.UNVERIFIED)
    expect((yield* plans.list(test.sessionID)).some((plan) => plan.status === "approved")).toBe(true)
    expect(requests).toHaveLength(0)
  }),
)

it.live("work added during review prevents completion even when the reviewer passes", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const goals = yield* SessionGoal.Service
    const todos = yield* SessionTodo.Service
    yield* goals.start(test.sessionID, { objective: "Record a plan" })
    duringReview = todos
      .update({
        sessionID: test.sessionID,
        todos: [{ content: "Verify the newly requested error state", status: "pending", priority: "high" }],
      })
      .pipe(Effect.asVoid, Effect.orDie)
    expect((yield* test.run("goal_complete", { evidence: [test.file], explanation: "Ready" })).type).toBe("error")
    expect(requests).toHaveLength(1)
    expect((yield* goals.get(test.sessionID))?.status).toBe("active")
  }),
)

it.live("review feedback, stale files and a concurrent pause cannot complete the goal", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const goals = yield* SessionGoal.Service
    yield* goals.start(test.sessionID, { objective: "Verified artifact" })
    review = "FAIL\nBrowser evidence is missing"
    yield* test.run("goal_complete", { evidence: [test.file], explanation: "Done" })
    expect((yield* goals.get(test.sessionID))?.reason).toContain("Browser evidence")
    review = "PASS"
    duringReview = Effect.promise(() => Bun.write(test.file, "Changed during review")).pipe(Effect.asVoid)
    expect((yield* test.run("goal_complete", { evidence: [test.file], explanation: "Done" })).type).toBe("error")
    duringReview = goals.control(test.sessionID, { action: "pause" }).pipe(Effect.orDie, Effect.asVoid)
    expect((yield* test.run("goal_complete", { evidence: [test.file], explanation: "Done" })).type).toBe("error")
    expect((yield* goals.get(test.sessionID))?.status).toBe("paused")
  }),
)

it.live("steering admitted during review prevents completion and preserves review usage", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const goals = yield* SessionGoal.Service
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    yield* goals.start(test.sessionID, { objective: "Record a plan" })
    duringReview = SessionInput.admit(database.db, events, {
      id: SessionMessage.ID.create(),
      sessionID: test.sessionID,
      prompt: Prompt.make({ text: "Include rollback before finishing" }),
      delivery: "steer",
    }).pipe(Effect.asVoid)
    expect((yield* test.run("goal_complete", { evidence: [test.file], explanation: "Ready" })).type).toBe("error")
    const goal = yield* goals.get(test.sessionID)
    expect(goal?.status).toBe("active")
    expect(goal?.tokens).toBe(15)
    expect(goal?.reviews).toBe(1)
    expect(yield* SessionInput.hasPending(database.db, test.sessionID, "steer")).toBe(true)
  }),
)

it.live("a paused review keeps its measured usage without undoing the pause", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const goals = yield* SessionGoal.Service
    yield* goals.start(test.sessionID, { objective: "Record a plan" })
    duringReview = goals.control(test.sessionID, { action: "pause" }).pipe(Effect.orDie, Effect.asVoid)
    expect((yield* test.run("goal_complete", { evidence: [test.file], explanation: "Ready" })).type).toBe("error")
    const goal = yield* goals.get(test.sessionID)
    expect(goal?.status).toBe("paused")
    expect(goal?.tokens).toBe(15)
    expect(goal?.reviews).toBe(1)
  }),
)

it.live("a new steer or a late file change invalidates a reviewed candidate before runner settlement", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const goals = yield* SessionGoal.Service
    const completion = yield* SessionGoalCompletion.Service
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    yield* goals.start(test.sessionID, { objective: "Record a plan" })
    yield* test.run("goal_complete", { evidence: [test.file], explanation: "Ready" })
    yield* Effect.promise(() => Bun.write(test.file, "Changed by a late tool hook"))
    expect((yield* completion.settle(test.sessionID).pipe(Effect.exit))._tag).toBe("Failure")
    expect((yield* goals.get(test.sessionID))?.status).toBe("active")
    yield* test.run("goal_complete", { evidence: [test.file], explanation: "Ready again" })
    yield* SessionInput.admit(database.db, events, {
      id: SessionMessage.ID.create(),
      sessionID: test.sessionID,
      prompt: Prompt.make({ text: "Include rollback before finishing" }),
      delivery: "steer",
    })
    expect((yield* completion.settle(test.sessionID).pipe(Effect.exit))._tag).toBe("Failure")
    expect((yield* goals.get(test.sessionID))?.status).toBe("active")
    expect((yield* goals.get(test.sessionID))?.tokens).toBe(30)
  }),
)

it.live("Plan-only goals record a ready revision without requesting Build", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const goals = yield* SessionGoal.Service
    const plans = yield* SessionPlan.Service
    yield* goals.start(test.sessionID, { objective: "Produce a plan", agent: AgentV2.ID.make("plan") })
    expect((yield* test.run("plan_exit", { path: test.file })).type).not.toBe("error")
    expect(questions).toHaveLength(0)
    expect((yield* plans.list(test.sessionID))[0].status).toBe("ready")
  }),
)

it.live("plan approval shows the content and rejects a changed revision", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const plans = yield* SessionPlan.Service
    expect((yield* test.run("plan_exit", { path: test.file + ".missing" })).type).toBe("error")
    expect(questions).toHaveLength(0)
    duringApproval = Effect.promise(() => Bun.write(test.file, "A different plan")).pipe(Effect.asVoid)
    expect((yield* test.run("plan_exit", { path: test.file, tasks: planTasks })).type).toBe("error")
    expect(questions[0].questions[0].question).toContain("# Plan")
    expect((yield* plans.list(test.sessionID))[0].status).toBe("ready")
    duringApproval = Effect.void
    expect(
      (yield* test.run("plan_exit", { path: test.file, tasks: [{ ...planTasks[0], quote: "A different plan" }] })).type,
    ).not.toBe("error")
    // Revisions can share a millisecond; approval belongs to the reviewed content, not an array position.
    const revisions = yield* plans.list(test.sessionID)
    expect(revisions).toHaveLength(2)
    expect(revisions.find((plan) => plan.content === "A different plan")).toMatchObject({ status: "approved" })
    expect(revisions.filter((plan) => plan.status === "approved")).toHaveLength(1)
  }),
)

it.live("explicit Goal execution consent approves Plan without another question", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const goals = yield* SessionGoal.Service
    const plans = yield* SessionPlan.Service
    const goal = yield* goals.start(test.sessionID, {
      objective: "Implement this plan",
      agent: AgentV2.ID.make("plan"),
      executePlan: true,
    })
    expect(goal.stopAfter).toBe("build")
    expect((yield* test.run("plan_exit", { path: test.file, tasks: planTasks })).type).not.toBe("error")
    expect(questions).toHaveLength(0)
    expect((yield* plans.list(test.sessionID))[0].status).toBe("approved")
  }),
)

it.live("a Goal created during a pending Plan approval prevents a stale transition", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const goals = yield* SessionGoal.Service
    const plans = yield* SessionPlan.Service
    duringApproval = goals
      .start(test.sessionID, { objective: "Only plan", agent: AgentV2.ID.make("plan") })
      .pipe(Effect.orDie, Effect.asVoid)
    expect((yield* test.run("plan_exit", { path: test.file, tasks: planTasks })).type).toBe("error")
    expect((yield* plans.list(test.sessionID))[0].status).toBe("ready")
  }),
)

it.live("Build requires decomposition and repeated approval preserves renamed task progress", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const todos = yield* SessionTodo.Service
    expect((yield* test.run("plan_exit", { path: test.file, tasks: [] })).type).toBe("error")
    expect(questions).toHaveLength(0)
    expect((yield* test.run("plan_exit", { path: test.file, tasks: planTasks })).type).not.toBe("error")
    expect(questions[0].questions[0].question).toContain(planTasks[0].criterion)
    const created = (yield* todos.get(test.sessionID))[0]
    expect(created).toMatchObject({ source: { type: "plan", key: "button" }, criterion: planTasks[0].criterion })
    const updated = yield* todos.update({
      sessionID: test.sessionID,
      todos: [
        {
          id: created.id,
          revision: created.revision,
          content: "Button implementation under review",
          priority: "high",
          status: "blocked",
          reason: "Need browser access",
        },
      ],
    })
    expect((yield* test.run("plan_exit", { path: test.file, tasks: planTasks })).type).not.toBe("error")
    expect(questions).toHaveLength(1)
    expect(yield* todos.get(test.sessionID)).toEqual(updated)
    expect(
      (yield* test.run("plan_exit", { path: test.file, tasks: [{ ...planTasks[0], criterion: "Different scope" }] }))
        .type,
    ).toBe("error")
  }),
)

it.live("plan decomposition rejects unmatched quotes and duplicates, while a new revision preserves prior work", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const todos = yield* SessionTodo.Service
    expect(
      (yield* test.run("plan_exit", { path: test.file, tasks: [{ ...planTasks[0], quote: "Invented" }] })).type,
    ).toBe("error")
    expect((yield* test.run("plan_exit", { path: test.file, tasks: [planTasks[0], planTasks[0]] })).type).toBe("error")
    expect(yield* todos.get(test.sessionID)).toHaveLength(0)
    expect((yield* test.run("plan_exit", { path: test.file, tasks: planTasks })).type).not.toBe("error")
    const before = (yield* todos.get(test.sessionID))[0]
    yield* Effect.promise(() => Bun.write(test.file, "# Plan\nChange the button label. Add keyboard verification."))
    expect((yield* test.run("plan_exit", { path: test.file, tasks: planTasks })).type).not.toBe("error")
    const after = yield* todos.get(test.sessionID)
    expect(after).toHaveLength(2)
    expect(after[0]).toEqual(before)
    expect(after[1].source?.id).not.toBe(before.source?.id)
  }),
)

for (const decision of ["needs_revision", "unavailable", "inconclusive"] as const) {
  it.live(`a ${decision} task evaluation leaves the plan ready and admits no tasks`, () =>
    Effect.gen(function* () {
      const test = yield* setup
      const plans = yield* SessionPlan.Service
      const todos = yield* SessionTodo.Service
      taskDecision = decision
      expect((yield* test.run("plan_exit", { path: test.file, tasks: planTasks })).type).toBe("error")
      expect((yield* plans.list(test.sessionID))[0]?.status).toBe("ready")
      expect(yield* todos.get(test.sessionID)).toEqual([])
    }),
  )
}

it.live("a goal paused while tasks are evaluated cannot approve a plan", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const goals = yield* SessionGoal.Service
    const plans = yield* SessionPlan.Service
    yield* goals.start(test.sessionID, { objective: "Implement this plan", executePlan: true })
    duringTasks = goals.control(test.sessionID, { action: "pause" }).pipe(Effect.orDie, Effect.asVoid)
    expect((yield* test.run("plan_exit", { path: test.file, tasks: planTasks })).type).toBe("error")
    expect((yield* plans.list(test.sessionID))[0]?.status).toBe("ready")
    expect((yield* goals.get(test.sessionID))?.status).toBe("paused")
    const todos = yield* SessionTodo.Service
    expect(yield* todos.get(test.sessionID)).toEqual([])
  }),
)

it.live("a plan file changed during task evaluation cannot leave executable tasks", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const plans = yield* SessionPlan.Service
    const todos = yield* SessionTodo.Service
    duringTasks = Effect.promise(() => Bun.write(test.file, "A changed plan requiring another review")).pipe(
      Effect.asVoid,
    )
    expect((yield* test.run("plan_exit", { path: test.file, tasks: planTasks })).type).toBe("error")
    expect((yield* plans.list(test.sessionID))[0]?.status).toBe("ready")
    expect(yield* todos.get(test.sessionID)).toEqual([])
  }),
)

it.live("steering admitted during plan approval keeps the reviewed plan ready", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const plans = yield* SessionPlan.Service
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    duringApproval = SessionInput.admit(database.db, events, {
      id: SessionMessage.ID.create(),
      sessionID: test.sessionID,
      prompt: Prompt.make({ text: "Only prepare the plan; do not execute it" }),
      delivery: "steer",
    }).pipe(Effect.asVoid)
    expect((yield* test.run("plan_exit", { path: test.file, tasks: planTasks })).type).toBe("error")
    expect((yield* plans.list(test.sessionID))[0]?.status).toBe("ready")
    expect(yield* SessionInput.hasPending(database.db, test.sessionID, "steer")).toBe(true)
    const todos = yield* SessionTodo.Service
    expect(yield* todos.get(test.sessionID)).toEqual([])
  }),
)

it.live("an older approved plan can add a reviewed decomposition without trapping the handoff", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const goals = yield* SessionGoal.Service
    const plans = yield* SessionPlan.Service
    yield* goals.start(test.sessionID, { objective: "Only plan", agent: AgentV2.ID.make("plan") })
    const content = yield* Effect.promise(() => Bun.file(test.file).text())
    yield* plans.record({
      sessionID: test.sessionID,
      revision: createHash("sha256").update(content).digest("hex"),
      path: test.file,
      content,
      status: "approved",
      created: Date.now(),
    })
    const goal = yield* goals.get(test.sessionID)
    if (!goal) throw new Error("Expected goal")
    yield* goals.save(goal, { ...goal, status: "paused" })
    expect((yield* test.run("plan_exit", { path: test.file, tasks: planTasks })).type).not.toBe("error")
    expect(questions).toHaveLength(1)
    expect((yield* plans.list(test.sessionID))[0]).toMatchObject({ status: "approved", tasks: planTasks })
  }),
)

it.live("media declarations preserve named external-tool denials", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const external = yield* ExternalTools.Service
    let invoked = false
    deny = "image_test"
    yield* external.register({
      image_test: {
        description: "Image",
        inputSchema: { type: "object" },
        media: { operations: ["generate"], formats: ["image/png"], transparency: false },
        execute: async () => {
          invoked = true
          return { content: [] }
        },
      },
    })
    expect((yield* test.run("image_test", {}, AgentV2.ID.make("design"))).type).toBe("error")
    expect(assertions).toContain("image_test")
    expect(invoked).toBe(false)
  }),
)

it.live("Plan can inspect Design documents but cannot create a prototype through that tool", () =>
  Effect.gen(function* () {
    const test = yield* setup
    deny = "design_edit"
    expect((yield* test.run("design_document", { action: "list" }, AgentV2.ID.make("plan"))).type).not.toBe("error")
    expect(
      (yield* test.run(
        "design_document",
        { action: "create", input: { name: "Escape", journey: "new", engine: "html", kind: "screen" } },
        AgentV2.ID.make("plan"),
      )).type,
    ).toBe("error")
    const store = yield* DesignStore.Service
    expect(yield* store.list(test.sessionID)).toHaveLength(0)
  }),
)

it.live("design_document create has System One classify the target and the user confirm it preselected", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const store = yield* DesignStore.Service
    const before = classifications.length
    answer = "Presentation (Recommended)"
    const result = yield* test.run("design_document", {
      action: "create",
      input: { name: "Pitch", journey: "new", engine: "html", kind: "deck", target: "web" },
    })
    expect(result.type).not.toBe("error")
    expect(JSON.stringify(result)).toContain("Target: Presentation · playbooks: slides")
    expect(JSON.stringify(result)).toContain("detected by System One and confirmed by the user")
    expect(classifications).toHaveLength(before + 1)
    expect(classifications.at(-1)?.kind).toBe("classification")
    const asked = questions.flatMap((item) => item.questions).find((item) => item.header === DesignTarget.HEADER)
    expect(asked?.options[0]?.label).toBe("Presentation (Recommended)")
    expect(asked?.question).toContain("System One suggests Presentation (90% confident)")
    expect((yield* store.list(test.sessionID)).find((item) => item.name === "Pitch")?.target).toBe("presentation")
  }),
)

it.live("design_document create in single reasoning takes the agent's target without System One or a question", () =>
  Effect.gen(function* () {
    const test = yield* setup
    reasoning = "single"
    const store = yield* DesignStore.Service
    const before = classifications.length
    const result = yield* test.run("design_document", {
      action: "create",
      input: { name: "Runner", journey: "new", engine: "html", kind: "flow", target: "app", platform: "android" },
    })
    expect(result.type).not.toBe("error")
    expect(JSON.stringify(result)).toContain("Target: Android app · playbooks: mobile-app, quality")
    expect(classifications).toHaveLength(before)
    expect(questions.flatMap((item) => item.questions).some((item) => item.header === DesignTarget.HEADER)).toBe(false)
    expect((yield* store.list(test.sessionID)).find((item) => item.name === "Runner")).toMatchObject({
      target: "app",
      platform: "android",
    })
  }),
)

it.live("design_document renders the project's design system as paths and counts and refreshes its manifest", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const location = yield* Location.Service
    const text = (result: Effect.Success<ReturnType<typeof test.run>>) => {
      if (result.type === "error") return `ERROR ${result.value}`
      if (result.type === "text") return result.value
      if (result.type !== "content") return ""
      return result.value.map((part) => (part.type === "text" ? part.text : "")).join("")
    }
    const fresh = text(
      yield* test.run("design_document", {
        action: "create",
        input: { name: "Sketch", journey: "new", engine: "html", kind: "screen" },
      }),
    )
    expect(fresh).toContain("Design system: none detected. Say so in designSystem")
    expect(yield* Effect.promise(() => Bun.file(path.join(location.directory, ".red", "DESIGN.md")).exists())).toBe(
      false,
    )
    yield* Effect.promise(() =>
      Promise.all(
        Object.entries({
          "package.json": JSON.stringify({
            dependencies: { react: "^18.3.1" },
            devDependencies: { tailwindcss: "^3.4.1" },
          }),
          "tailwind.config.ts": "export default { content: ['./src/**/*.tsx'] }",
          "DESIGN.md": "# Guidance\nDO NOT LEAK INTO TOOL OUTPUT",
          "src/styles/globals.css": ":root { --accent: #0af; }",
          "src/components/index.ts": 'export { Button } from "./Button"\nexport { Card } from "./Card"',
          "src/components/Button.tsx":
            "export interface ButtonProps { label: string }\nexport const Button = () => null",
          "src/components/Card.tsx": "export const Card = () => null",
        }).map(([file, content]) => Bun.write(path.join(location.directory, file), content)),
      ),
    )
    const created = text(
      yield* test.run("design_document", {
        action: "create",
        input: { name: "Settings", journey: "existing", engine: "react", kind: "screen", application: "." },
      }),
    )
    expect(created).toContain("Design system (import from the component roots instead of re-implementing")
    expect(created).toContain(
      "Manifest: .red/DESIGN.md (generated from the files below; read it first, edit only its Notes)",
    )
    expect(created).toContain("Manifest status: generated .red/DESIGN.md")
    expect(created).toContain("Docs: DESIGN.md (authoritative; read with the read tool before designing)")
    expect(created).not.toContain("DO NOT LEAK")
    expect(created).toContain("Tokens: src/styles/globals.css")
    expect(created).toContain("Pipeline: Tailwind (tailwind.config.ts); CSS custom properties (src/styles/globals.css)")
    expect(created).toContain("Framework: react ^18.3.1")
    expect(created).toContain("Components src/components: Button, Card")
    const store = yield* DesignStore.Service
    const document = (yield* store.list(test.sessionID)).find((item) => item.name === "Settings")!
    expect(document.inventory).toEqual([
      { root: "src/components", file: "src/components/Button.tsx", name: "Button", props: "ButtonProps" },
      { root: "src/components", file: "src/components/Card.tsx", name: "Card" },
    ])
    const listed = text(yield* test.run("design_document", { action: "list" }))
    expect(listed).toContain("Design system: none detected")
    expect(listed).toContain(
      "Design system: manifest .red/DESIGN.md; docs DESIGN.md; 1 token file; 2 components in src/components",
    )
    expect(listed).not.toContain("Manifest status")
    const manifest = path.join(document.application, ".red", "DESIGN.md")
    const unchanged = text(yield* test.run("design_document", { action: "refresh", id: document.id }))
    expect(unchanged).not.toContain("Manifest status")
    yield* Effect.promise(async () => {
      await Bun.write(path.join(location.directory, "src/components/Badge.tsx"), "export const Badge = () => null")
      await Bun.write(manifest, (await Bun.file(manifest).text()) + "Keep the 4px rhythm.\n")
    })
    const refreshed = text(yield* test.run("design_document", { action: "refresh", id: document.id }))
    expect(refreshed).toContain("Manifest status: refreshed the generated block in .red/DESIGN.md")
    expect(refreshed).toContain("Components src/components: Badge, Button, Card")
    expect(refreshed).not.toContain("- Badge (src/components/Badge.tsx)")
    const written = yield* Effect.promise(() => Bun.file(manifest).text())
    expect(written).toContain("- Badge (src/components/Badge.tsx)")
    expect(written.endsWith("Keep the 4px rhythm.\n")).toBe(true)
  }),
)

it.live("Design approval for an existing application asks for target files before the user is asked", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const store = yield* DesignStore.Service
    const document = yield* store.create(test.sessionID, {
      name: "Leads",
      journey: "existing",
      engine: "html",
      kind: "screen",
    })
    yield* store.publish(document.id, "Review")
    const asked = questions.length
    const refused = yield* test.run("design_exit", { id: document.id }, AgentV2.ID.make("design"))
    expect(refused.type).toBe("error")
    expect(JSON.stringify(refused)).toContain(
      "Record the product files this design changes with design_document update targets, or confirm none apply",
    )
    expect(questions).toHaveLength(asked)
    expect((yield* store.get(document.id)).approvedRevision).toBeNull()
    answer = "Approve"
    const confirmed = yield* test.run("design_exit", { id: document.id, noTargets: true }, AgentV2.ID.make("design"))
    expect(confirmed.type).not.toBe("error")
    expect(questions).toHaveLength(asked + 1)
    expect((yield* store.get(document.id)).approvedRevision).not.toBeNull()
  }),
)

it.live("Design approval is refused while the latest feedback round has notes without a status", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const store = yield* DesignStore.Service
    const document = yield* store.create(test.sessionID, {
      name: "Leads",
      journey: "new",
      engine: "html",
      kind: "screen",
    })
    const first = yield* store.publish(document.id, "Review")
    const feedback = {
      id: SessionMessage.ID.create(),
      revision: first.id,
      text: "",
      items: [{ target: "#title", text: "Bigger", label: 'h1 "Leads"' }],
      assets: [],
      snapshot: "",
      delivery: "queue" as const,
      end: false,
    }
    yield* store.prepareFeedback(document.id, feedback)
    yield* store.acknowledge(document.id, feedback)
    yield* store.publish(document.id, "Answered")
    const asked = questions.length
    const refused = yield* test.run("design_exit", { id: document.id }, AgentV2.ID.make("design"))
    expect(refused.type).toBe("error")
    expect(JSON.stringify(refused)).toContain(
      "Approval is not possible yet. Round 1 has 1 note without a recorded outcome",
    )
    expect(questions).toHaveLength(asked)
    // A status without verify evidence is refused with the recent verify jobs named, like todowrite.
    const unproven = yield* test.run(
      "design_document",
      {
        action: "update",
        id: document.id,
        input: { notes: [{ feedback: feedback.id, index: 1, status: "resolved" }] },
      },
      AgentV2.ID.make("design"),
    )
    expect(unproven.type).toBe("error")
    expect(JSON.stringify(unproven)).toContain("Note status refused:")
    expect(JSON.stringify(unproven)).toContain("Verify jobs: none")
    const recorded = yield* test.run(
      "design_document",
      {
        action: "update",
        id: document.id,
        input: {
          notes: [{ feedback: feedback.id, index: 1, status: "accepted", reason: "Heading size is set by the app" }],
        },
      },
      AgentV2.ID.make("design"),
    )
    expect(recorded.type).not.toBe("error")
    expect(JSON.stringify(recorded)).toContain("round 1 (answered by")
    answer = "Approve"
    expect((yield* test.run("design_exit", { id: document.id }, AgentV2.ID.make("design"))).type).not.toBe("error")
    expect(questions).toHaveLength(asked + 1)
  }),
)

it.live("Design-only approval presents current findings and preserves its scope", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const store = yield* DesignStore.Service
    const goals = yield* SessionGoal.Service
    const document = yield* store.create(test.sessionID, {
      name: "Checkout",
      journey: "new",
      engine: "html",
      kind: "screen",
    })
    const revision = yield* store.publish(document.id, "Review")
    yield* store.putJob({
      id: "audit_fixture",
      designID: document.id,
      input: { revision: revision.id, format: "audit" },
      status: "completed",
      progress: 1,
      result: "audit.html",
      error: null,
      created: 1,
      audit: {
        revision: revision.id,
        findings: ["Small screen overflow"],
        scenarios: ["Cart exercised"],
        widths: [390],
      },
    })
    const report = yield* test.run("design_jobs", { id: document.id }, AgentV2.ID.make("design"))
    expect(report.type).toBe("text")
    expect(report.value).toContain("Small screen overflow")
    expect(report.value).toContain("Historical audit has no capture manifest")
    yield* goals.start(test.sessionID, { objective: "Approve a prototype", agent: AgentV2.ID.make("design") })
    answer = "Approve"
    expect((yield* test.run("design_exit", { id: document.id }, AgentV2.ID.make("design"))).type).not.toBe("error")
    expect(questions[0].questions[0].question).toContain("Small screen overflow")
    expect(questions[0].questions[0].options[0].description).toContain("stay in Design")
    expect((yield* store.get(document.id)).approvedRevision).toBe(revision.id)
    expect((yield* goals.get(test.sessionID))?.stopAfter).toBe("design")
  }),
)
