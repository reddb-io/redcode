import { describe, expect } from "bun:test"
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
import { SessionTodoEvidence } from "../src/session/todo-evidence"
import { SessionTodoStore } from "../src/session/todo-store"
import type { SessionMessage } from "../src/session/message"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tempLocationLayer } from "./fixture/location"
import { tool } from "./intelligence/fixtures"
import { testEffect } from "./lib/effect"

// The session's tool history as the task gate reads it, replaced between writes the way steps add to it.
const requests = [{ id: "msg_review", text: "Polish the checkout design", created: 0 }]
let history: SessionMessage.Info[] = []
const facts = (messages: SessionMessage.Info[]) =>
  Effect.sync(() => {
    history = messages
  })

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Location.node, SessionTodoStore.node]), [
    Location.node.replace(tempLocationLayer),
    SessionTaskFacts.node.replace(
      Layer.mock(SessionTaskFacts.Service, {
        load: () => Effect.sync(() => ({ requests, results: SessionTaskFacts.project(history) })),
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

const start = Effect.fnUntraced(function* (name: string, phase: "design" | "build") {
  const database = yield* Database.Service
  const location = yield* Location.Service
  const todos = yield* SessionTodoStore.Service
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
      agent: phase,
      version: "test",
    })
    .run()
  yield* facts([])
  const written = yield* todos.write({
    sessionID,
    phase,
    todos: [{ content: "Tighten the checkout spacing", criterion: "The spacing matches the grid", priority: "high" }],
  })
  return { sessionID, task: written.todos[0]! }
})

const preview = (id: string, design: string, completed: number) =>
  tool(id, "design_preview", { id: design, name: "Checkout" }, { completed })
const designEdit = (id: string, design: string, completed: number) =>
  tool(id, "design_edit", { id: design }, { completed })
// A refused completion of `task`, as the runtime records the tool error.
const refused = (id: string, task: string, completed: number) =>
  tool(
    id,
    "todowrite",
    { todos: [{ id: task, status: "completed", evidence: { callID: "call_none" } }] },
    { completed, error: `${SessionTodoEvidence.REFUSED} Evidence callID "call_none" does not match any tool result.` },
  )

describe("Design task evidence", () => {
  it.live("attaches the newest fresh design verification and says which one", () =>
    Effect.gen(function* () {
      const todos = yield* SessionTodoStore.Service
      const { sessionID, task } = yield* start("design_attach", "design")
      yield* facts([designEdit("msg_edit", "design_a", 1), preview("msg_preview", "design_a", 2)])
      const auto = yield* todos.write({ sessionID, phase: "design", todos: [{ id: task.id, status: "completed" }] })
      expect(auto.todos[0]).toMatchObject({ status: "completed", evidence: { callID: "call_msg_preview" } })
      expect(auto.notes[0]).toStartWith(`${task.id}: Evidence attached automatically: call_msg_preview (design_preview`)

      // Citing the edit itself is refused for every other task; a Design task gets the fresh preview instead.
      const { sessionID: cited, task: other } = yield* start("design_cited", "design")
      yield* facts([designEdit("msg_edit", "design_a", 1), preview("msg_preview", "design_a", 2)])
      const fallback = yield* todos.write({
        sessionID: cited,
        phase: "design",
        todos: [
          {
            id: other.id,
            status: "completed",
            evidence: { callID: "call_msg_edit", explanation: "The spacing now follows the grid" },
          },
        ],
      })
      expect(fallback.todos[0]).toMatchObject({
        status: "completed",
        evidence: { callID: "call_msg_preview", explanation: "The spacing now follows the grid" },
      })
      expect(fallback.notes[0]).toContain('the cited evidence was not usable: Evidence callID "call_msg_edit"')
    }),
  )

  it.live("an edit of another design leaves the preview valid; an edit of the same design asks for a new one", () =>
    Effect.gen(function* () {
      const todos = yield* SessionTodoStore.Service
      const { sessionID, task } = yield* start("design_scope", "design")
      // Another design, through its tool and through a file in its work directory, is not this preview's design.
      yield* facts([
        preview("msg_preview", "design_a", 2),
        designEdit("msg_other", "design_b", 3),
        tool("msg_work_b", "edit", { filePath: ".red/code/design/design_b/work/index.html" }, { completed: 4 }),
      ])
      const kept = yield* todos.write({ sessionID, phase: "design", todos: [{ id: task.id, status: "completed" }] })
      expect(kept.todos[0]).toMatchObject({ status: "completed", evidence: { callID: "call_msg_preview" } })

      const { sessionID: same, task: stale } = yield* start("design_stale", "design")
      yield* facts([
        preview("msg_preview", "design_a", 2),
        tool("msg_work_a", "edit", { filePath: ".red/code/design/design_a/work/index.html" }, { completed: 3 }),
      ])
      const error = yield* todos
        .write({ sessionID: same, phase: "design", todos: [{ id: stale.id, status: "completed" }] })
        .pipe(Effect.flip)
      expect(error.message).toStartWith(
        `${SessionTodoEvidence.REFUSED} Next step: call design_preview for design_a (or design_export for an export or a verify) after your last design edit, then resend this completion without evidence`,
      )
      expect(error.message).toContain("this refusal does not block the task")
    }),
  )

  it.live("refusals never block a Design task, while the same refusals block a Build task", () =>
    Effect.gen(function* () {
      const todos = yield* SessionTodoStore.Service
      const { sessionID, task } = yield* start("design_unblocked", "design")
      const attempt = () =>
        todos
          .write({
            sessionID,
            phase: "design",
            todos: [{ id: task.id, status: "completed", evidence: { callID: "call_none", explanation: "Done" } }],
          })
          .pipe(Effect.flip)
      yield* facts([
        preview("msg_preview", "design_a", 2),
        designEdit("msg_edit", "design_a", 3),
        refused("msg_refused_1", task.id, 4),
        refused("msg_refused_2", task.id, 5),
      ])
      expect((yield* attempt()).message).toContain("Next step: call design_preview for design_a")
      expect((yield* todos.get(sessionID))[0]).toMatchObject({ status: "in_progress" })

      const build = yield* start("build_blocked", "build")
      yield* facts([
        tool("msg_test", "bash", { command: "bun test" }, { completed: 2, exit: 0 }),
        tool("msg_change", "edit", { filePath: "src/checkout.ts" }, { completed: 3 }),
        refused("msg_refused_1", build.task.id, 4),
      ])
      const blocked = yield* todos.write({
        sessionID: build.sessionID,
        phase: "build",
        todos: [{ id: build.task.id, status: "completed", evidence: { callID: "call_none", explanation: "Done" } }],
      })
      expect(blocked.todos[0]).toMatchObject({ status: "blocked" })
      expect(blocked.todos[0]!.reason).toContain("completion evidence could not be verified after 2 attempts")
      expect(blocked.todos[0]!.reason).not.toContain("Next step")
      expect(blocked.notes).toEqual([])
    }),
  )

  it.live("a Build task never gets evidence attached on its behalf", () =>
    Effect.gen(function* () {
      const todos = yield* SessionTodoStore.Service
      const { sessionID, task } = yield* start("build_cited", "build")
      yield* facts([
        tool("msg_change", "edit", { filePath: "src/checkout.ts" }, { completed: 1 }),
        tool("msg_test", "bash", { command: "bun test" }, { completed: 2, exit: 0 }),
      ])
      const error = yield* todos
        .write({
          sessionID,
          phase: "build",
          todos: [{ id: task.id, status: "completed", evidence: { callID: "call_msg_change", explanation: "Edited" } }],
        })
        .pipe(Effect.flip)
      expect(error.message).toContain("is the edit itself")
      expect(error.message).not.toContain("Next step")
    }),
  )
})
