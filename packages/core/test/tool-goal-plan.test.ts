import { AgentV2 } from "../src/agent"
import { expect } from "bun:test"
import path from "node:path"
import { Effect, Layer } from "effect"
import { LLMClient, LLMEvent, LLMResponse, Message, Model, Usage, type LLMRequest } from "@reddb-io/redcode-llm"
import { OpenAIChat } from "@reddb-io/redcode-llm/protocols/openai-chat"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { llmClient } from "../src/effect/app-node-platform"
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
import { ToolRegistry } from "../src/tool/registry"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"

const requests: LLMRequest[] = []
const questions: QuestionV2.AskInput[] = []
const assertions: string[] = []
let review = "PASS\nVerified"
let duringReview = Effect.void
let duringApproval = Effect.void
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
        llmClient,
        Layer.succeed(
          LLMClient.Service,
          LLMClient.Service.of({
            prepare: () => Effect.die("unused"),
            stream: () => {
              throw new Error("unused")
            },
            generate: (request) =>
              Effect.gen(function* () {
                requests.push(request)
                yield* duringReview
                return new LLMResponse({
                  message: Message.assistant(review),
                  events: [LLMEvent.textDelta({ id: "review", text: review })],
                  finishReason: "stop",
                  usage: new Usage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
                })
              }),
          }),
        ),
      ],
    ],
  ),
)

const setup = Effect.gen(function* () {
  requests.length = 0
  questions.length = 0
  assertions.length = 0
  review = "PASS\nVerified"
  duringReview = Effect.void
  duringApproval = Effect.void
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
    expect(JSON.stringify(requests[0].messages)).toContain("Exit 0")
    expect(JSON.stringify(requests[0].messages)).toContain("# Plan")
    expect(requests[0].tools).toEqual([])
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

it.live("work added during review prevents completion even when the reviewer passes", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const goals = yield* SessionGoal.Service
    const todos = yield* SessionTodo.Service
    yield* goals.start(test.sessionID, { objective: "Record a plan" })
    duringReview = todos.update({
      sessionID: test.sessionID,
      todos: [{ content: "Verify the newly requested error state", status: "pending", priority: "high" }],
    })
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
    expect((yield* test.run("plan_exit", { path: test.file })).type).toBe("error")
    expect(questions[0].questions[0].question).toContain("# Plan")
    expect((yield* plans.list(test.sessionID))[0].status).toBe("ready")
    duringApproval = Effect.void
    expect((yield* test.run("plan_exit", { path: test.file })).type).not.toBe("error")
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
    expect((yield* test.run("plan_exit", { path: test.file })).type).not.toBe("error")
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
    expect((yield* test.run("plan_exit", { path: test.file })).type).toBe("error")
    expect((yield* plans.list(test.sessionID))[0].status).toBe("ready")
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
    yield* goals.start(test.sessionID, { objective: "Approve a prototype", agent: AgentV2.ID.make("design") })
    answer = "Approve"
    expect((yield* test.run("design_exit", { id: document.id }, AgentV2.ID.make("design"))).type).not.toBe("error")
    expect(questions[0].questions[0].question).toContain("Small screen overflow")
    expect(questions[0].questions[0].options[0].description).toContain("stay in Design")
    expect((yield* store.get(document.id)).approvedRevision).toBe(revision.id)
    expect((yield* goals.get(test.sessionID))?.stopAfter).toBe("design")
  }),
)
