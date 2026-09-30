import { expect, test } from "bun:test"
import { SessionTodo } from "@opencode/schema/session-todo"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Database } from "../src/database/database"
import { Intelligence } from "../src/intelligence"
import { Location } from "../src/location"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { SessionTaskFacts } from "../src/session/task-facts"
import { SessionTodoStore } from "../src/session/todo-store"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

test("task selection keeps Design and Build separate and includes the Design handoff in Plan", () => {
  const tasks = [{ phase: "design" as const }, { phase: "build" as const }, { phase: "plan" as const }, {}]
  expect(SessionTodo.forAgent(tasks, "design")).toEqual([tasks[0]!])
  expect(SessionTodo.forAgent(tasks, "build")).toEqual([tasks[1]!, tasks[3]!])
  expect(SessionTodo.forAgent(tasks, "plan")).toEqual([tasks[0]!, tasks[2]!])
})

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Location.node, SessionTodoStore.node]), [
    Location.node.replace(tempLocationLayer),
    SessionTaskFacts.node.replace(
      Layer.mock(SessionTaskFacts.Service, {
        load: () =>
          Effect.succeed({
            requests: [{ id: "msg_profile", text: "Design and implement a profile", created: 1 }],
            results: [],
          }),
      }),
    ),
    Intelligence.node.replace(
      Layer.mock(Intelligence.Service, {
        read: () => Effect.succeed({ enabled: false, reasoning: "single", onboarding: "completed" }),
        history: () => Effect.succeed([]),
        evaluate: () => Effect.succeed(undefined),
      }),
    ),
  ]),
)

it.live("an approved plan closes accepted Design tasks atomically and preserves independent Build tasks", () =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const location = yield* Location.Service
    const todos = yield* SessionTodoStore.Service
    const sessionID = Session.ID.make("ses_design_phases")
    const project = Project.ID.make("design-task-phases")
    yield* database.db.insert(ProjectTable).values({ id: project, worktree: location.directory, sandboxes: [] }).run()
    yield* database.db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: project,
        directory: location.directory,
        slug: "profile",
        agent: "design",
        version: "test",
      })
      .run()
    yield* todos.write({ sessionID, phase: "design", todos: [{ content: "Approve profile", priority: "high" }] })
    yield* todos.write({ sessionID, phase: "build", todos: [{ content: "Approve profile", priority: "high" }] })
    const before = yield* todos.get(sessionID)
    expect(before).toHaveLength(2)
    expect(before.map((task) => task.status)).toEqual(["in_progress", "in_progress"])
    yield* todos.write({
      sessionID,
      phase: "build",
      acceptDesign: true,
      origin: { type: "plan", id: "approved_profile", quote: "Implement profile", created: 2 },
      todos: [
        {
          planKey: "profile",
          content: "Implement profile",
          criterion: "Profile uses approved layout",
          requirement: "Implement profile",
          priority: "high",
        },
      ],
    })
    const after = yield* todos.get(sessionID)
    expect(after.find((task) => task.phase === "design")).toMatchObject({
      status: "completed",
      reason: "Prototype and implementation plan approved by the user",
    })
    expect(after.find((task) => task.id === before[1]!.id)?.status).toBe("in_progress")
    expect(after.filter((task) => task.phase === "build")).toHaveLength(2)
    expect(yield* todos.review(sessionID)).toEqual(after)
    yield* todos.write({
      sessionID,
      phase: "design",
      todos: [{ content: "Refine subscription card after feedback", priority: "high" }],
    })
    expect(
      SessionTodo.forAgent(yield* todos.get(sessionID), "design").filter((task) => task.status !== "completed"),
    ).toHaveLength(1)
  }),
)
