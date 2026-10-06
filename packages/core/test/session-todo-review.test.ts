import { describe, expect } from "bun:test"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Database } from "../src/database/database"
import { Intelligence } from "../src/intelligence"
import type { EvaluationInput } from "../src/intelligence"
import { IntelligenceEvaluation } from "../src/intelligence/evaluation"
import { Location } from "../src/location"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { SessionTaskFacts } from "../src/session/task-facts"
import { SessionTodoStore } from "../src/session/todo-store"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tempLocationLayer } from "./fixture/location"
import { evaluation } from "./intelligence/fixtures"
import { testEffect } from "./lib/effect"

// What System One was asked, how many requests were open at once, and how it answers a question.
const asked: EvaluationInput[] = []
const flight = { open: 0, most: 0 }
const answers: { noul: (id: string, input: EvaluationInput) => number; unavailable: boolean } = {
  noul: () => 0.01,
  unavailable: false,
}

const reset = () => {
  asked.length = 0
  flight.open = 0
  flight.most = 0
  answers.noul = () => 0.01
  answers.unavailable = false
}

/** Answers every question through the real gate rules, holding each request open briefly so overlap shows. */
const evaluate = (input: EvaluationInput) =>
  Effect.gen(function* () {
    asked.push(input)
    flight.open++
    flight.most = Math.max(flight.most, flight.open)
    yield* Effect.sleep("40 millis")
    flight.open--
    if (answers.unavailable)
      return evaluation({
        id: `evaluation_${asked.length}`,
        operation: input.operation,
        decision: "unavailable",
        answers: {},
        issues: ["Evaluation unavailable: System One did not answer. Previous state preserved."],
      })
    const response = {
      model: "jev",
      answers: Object.fromEntries(
        Object.entries(input.questions).map(([id, question]) => [
          id,
          question.type === "noul"
            ? { type: "noul" as const, noul: answers.noul(id, input) }
            : {
                type: "score" as const,
                score: 3,
                confidence: 1,
                legend: {},
                probabilities: { "3": 1 },
              },
        ]),
      ),
      usage: { input_tokens: 1, output_tokens: 1, cost: 0 },
    }
    const decided = IntelligenceEvaluation.decide(input.questions, response, input.operation)
    return evaluation({
      id: `evaluation_${asked.length}`,
      operation: input.operation,
      decision: decided.decision,
      issues: decided.issues,
      answers: response.answers,
    })
  })

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Location.node, SessionTodoStore.node]), [
    Location.node.replace(tempLocationLayer),
    SessionTaskFacts.node.replace(
      Layer.mock(SessionTaskFacts.Service, {
        load: () =>
          Effect.succeed({
            requests: [{ id: "msg_checkout", text: "Build the checkout flow with fifteen steps", created: 1 }],
            results: [],
          }),
      }),
    ),
    Intelligence.node.replace(
      Layer.mock(Intelligence.Service, {
        read: () =>
          Effect.succeed({
            enabled: true,
            reasoning: "dual",
            // The test preload selects single reasoning globally; the session choice outranks it.
            sessionReasoning: "dual",
            onboarding: "completed",
            principal: { providerID: Provider.ID.make("fake"), id: Model.ID.make("fake-model") },
            evaluator: { transport: "red-router", baseURL: "http://127.0.0.1:1/v1", model: "jev" },
          }),
        history: () => Effect.succeed([]),
        evaluate,
      }),
    ),
  ]),
)

const session = Effect.fnUntraced(function* (name: string) {
  const database = yield* Database.Service
  const location = yield* Location.Service
  const sessionID = Session.ID.make(`ses_${name}`)
  const project = Project.ID.make(name)
  yield* database.db.insert(ProjectTable).values({ id: project, worktree: location.directory, sandboxes: [] }).run()
  yield* database.db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: project,
      directory: location.directory,
      slug: name,
      agent: "build",
      version: "test",
    })
    .run()
  return sessionID
})

const steps = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    content: `Checkout step ${index + 1}: render the form and validate its fields`,
    criterion: `Step ${index + 1} rejects an empty required field`,
    priority: "medium" as const,
  }))

describe("SessionTodoStore System One review", () => {
  it.live("judges fifteen new tasks in parallel batches, never one request per task", () =>
    Effect.gen(function* () {
      reset()
      const todos = yield* SessionTodoStore.Service
      const sessionID = yield* session("todo_review_batches")
      const written = yield* todos.write({ sessionID, todos: steps(15) })
      expect(written.todos).toHaveLength(15)
      expect(written.notes).toEqual([])
      const batches = Math.ceil(15 / SessionTodoStore.REVIEW.tasks)
      expect(asked).toHaveLength(batches)
      // Every batch was open at the same time: none waited for another.
      expect(flight.most).toBe(batches)
      for (const input of asked) {
        expect(input.operation).toBe("task_quality")
        expect(JSON.stringify(input).length).toBeLessThanOrEqual(SessionTodoStore.REVIEW.characters)
      }
      // Each task is judged exactly once, with its own questions.
      expect(
        asked.flatMap((input) => input.candidate as ReadonlyArray<{ content: string }>).map((task) => task.content),
      ).toEqual(steps(15).map((step) => step.content))
      expect(
        Object.keys(asked[0]!.questions)
          .filter((id) => id.startsWith("task_0_"))
          .toSorted(),
      ).toEqual(["task_0_coverage", "task_0_criterion", "task_0_quality", "task_0_scope"])
    }),
  )

  it.live("reads each task's verdict from its own questions in a shared request", () =>
    Effect.gen(function* () {
      reset()
      const todos = yield* SessionTodoStore.Service
      const sessionID = yield* session("todo_review_verdicts")
      // Inconclusive for the third task only: the update applies and only that task carries a note.
      answers.noul = (id) => (id === "task_2_scope" ? 0.6 : 0.01)
      const written = yield* todos.write({ sessionID, todos: steps(4) })
      expect(asked).toHaveLength(1)
      expect(written.notes).toHaveLength(1)
      expect(written.notes[0]).toStartWith(`${written.todos[2]!.id}: Unverified: System One review inconclusive`)
      expect(written.notes[0]).toContain("task_2_scope")

      // A refusal of one task names it and keeps the previous state.
      reset()
      answers.noul = (id) => (id === "task_1_criterion" ? 0.95 : 0.01)
      const refused = yield* todos
        .write({
          sessionID,
          todos: [
            { content: "Add the coupon field to checkout", priority: "low" },
            { content: "Polish checkout", priority: "low" },
          ],
        })
        .pipe(Effect.flip)
      expect(asked).toHaveLength(1)
      expect(refused.message).toMatch(/^todo_[^:]+: Semantic evaluation needs_revision/)
      expect(refused.message).toContain("task_1_criterion")
      expect(yield* todos.get(sessionID)).toHaveLength(4)
    }),
  )

  it.live("an unavailable System One still applies the update with a note per task", () =>
    Effect.gen(function* () {
      reset()
      answers.unavailable = true
      const todos = yield* SessionTodoStore.Service
      const sessionID = yield* session("todo_review_unavailable")
      const written = yield* todos.write({ sessionID, todos: steps(3) })
      expect(asked).toHaveLength(1)
      expect(written.todos).toHaveLength(3)
      expect(written.notes).toEqual(
        written.todos.map(
          (task) =>
            `${task.id}: Unverified: System One review unavailable (evaluation_1): System One did not answer. The update was applied without review.`,
        ),
      )
    }),
  )
})
