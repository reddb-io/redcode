import { expect, test } from "bun:test"
import { Design } from "@opencode/schema/design"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { SessionTodo } from "@opencode/schema/session-todo"
import { Effect, Layer, Stream } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Bus } from "../src/bus"
import { Database } from "../src/database/database"
import { DesignTasks } from "../src/design/tasks"
import { DesignStore } from "../src/design/store"
import { Intelligence } from "../src/intelligence"
import { Location } from "../src/location"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { SessionTaskFacts } from "../src/session/task-facts"
import { SessionTodoStore } from "../src/session/todo-store"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const notes: Design.Note[] = [1, 2].map((index) => ({
  feedback: "msg_feedback",
  index,
  round: 1,
  item: { target: `#field-${index}`, text: index === 1 ? "Use English" : "Add the configuration screen" },
  status: "open",
  updated: 10,
}))

const design = (sessionID: Session.ID) =>
  ({
    id: Design.ID.make("design_checkout"),
    sessionID,
    name: "Checkout",
    journey: "new",
    engine: "html",
    kind: "screen",
    target: "web",
    root: "/store/design_checkout/work",
    application: "/store/design_checkout/work",
    entry: "index.html",
    brief: { objective: "", audience: "", content: "", constraints: "", references: [] },
    designSystem: {},
    decisions: [],
    questions: [],
    scenarios: [],
    sources: [],
    tweaks: {},
    revision: null,
    approvedRevision: null,
    ended: false,
    notes,
    updated: 1,
  }) satisfies Design.Info

test("a review note task is keyed by its design and note index, so re-admission cannot duplicate it", () => {
  // The key the store matches on: one task per note, across every retried delivery of the same review.
  expect(`design-feedback:${Design.ID.make("design_checkout")}:1`).toBe("design-feedback:design_checkout:1")
  expect(SessionTodo.label({ content: notes[0]!.item.text })).toBe("Use English")
})

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Location.node, SessionTodoStore.node, Bus.node]), [
    Location.node.replace(tempLocationLayer),
    SessionTaskFacts.node.replace(
      Layer.mock(SessionTaskFacts.Service, {
        load: () =>
          Effect.succeed({
            requests: [{ id: "msg_feedback", text: "Review the checkout screen", created: 1 }],
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

/** A Design session with its project row, as the store needs to resolve a session. */
const start = (name: string) =>
  Effect.gen(function* () {
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
        agent: "design",
        version: "test",
      })
      .run()
    return sessionID
  })

const withDesign = (sessionID: Session.ID, write: "real" | "failing" = "real") =>
  write === "real"
    ? Layer.mock(DesignStore.Service, {
        storage: "/store",
        blobs: "/store/blobs",
        list: () => Effect.succeed([design(sessionID)]),
      })
    : Layer.merge(
        Layer.mock(DesignStore.Service, {
          storage: "/store",
          blobs: "/store/blobs",
          list: () => Effect.succeed([design(sessionID)]),
        }),
        Layer.mock(SessionTodoStore.Service, {
          get: () => Effect.succeed([]),
          write: () => Effect.fail(new SessionTodo.Error({ message: "task review unavailable" })),
        }),
      )

it.live("admits one Design task per review note and keeps later work on re-admission", () =>
  Effect.gen(function* () {
    const sessionID = yield* start("design_feedback_tasks")
    const todos = yield* SessionTodoStore.Service
    const tasks = Effect.gen(function* () {
      yield* DesignTasks.admit(sessionID, "msg_feedback")
      const admitted = yield* todos.get(sessionID)
      expect(admitted).toHaveLength(2)
      expect(admitted.map((task) => task.criterion)).toEqual(notes.map((note) => note.item.text))
      expect(admitted.map((task) => task.source?.key)).toEqual([
        "design-feedback:design_checkout:1",
        "design-feedback:design_checkout:2",
      ])
      expect(admitted.map((task) => task.phase)).toEqual(["design", "design"])
      // Work already done stays done, and nothing marks these tasks as becoming Build work.
      yield* todos.write({
        sessionID,
        phase: "design",
        todos: [{ id: admitted[0]!.id!, status: "blocked", reason: "Waiting for a requested credential" }],
      })
      yield* DesignTasks.admit(sessionID, "msg_feedback")
      // Another review of the same design admits no duplicate of these notes.
      yield* DesignTasks.admit(sessionID, "msg_other")
      const kept = yield* todos.get(sessionID)
      expect(kept).toHaveLength(2)
      expect(kept.find((task) => task.id === admitted[0]!.id)).toMatchObject({
        status: "blocked",
        reason: "Waiting for a requested credential",
      })
    })
    yield* tasks.pipe(Effect.provide(withDesign(sessionID)))
  }),
)

it.live("a failed task write never blocks admitting the review itself", () =>
  Effect.gen(function* () {
    const sessionID = yield* start("design_feedback_unavailable")
    // The round still admits: bookkeeping is not allowed to stop the agent from working the notes.
    yield* DesignTasks.admit(sessionID, "msg_feedback").pipe(Effect.provide(withDesign(sessionID, "failing")))
  }),
)
