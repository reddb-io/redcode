import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@reddb-io/redcode-core/database/database"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Project } from "@reddb-io/redcode-core/project"
import { ProjectTable } from "@reddb-io/redcode-core/project/sql"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { MessageTable, PartTable, SessionTable } from "@reddb-io/redcode-core/session/sql"
import { SessionTaskFacts } from "@reddb-io/redcode-core/session/task-facts"
import { SessionTodoStore } from "@reddb-io/redcode-core/session/todo-store"
import { renderTodoReport, todoReport } from "@/cli/cmd/debug/todos"
import { EventV2Bridge } from "@/event-v2-bridge"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Todo } from "@/session/todo"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Todo.node, SessionTaskFacts.node, Database.node, EventV2Bridge.node])),
)

const assistant = (at: number) =>
  ({
    role: "assistant",
    parentID: "msg_user",
    agent: "build",
    mode: "build",
    modelID: "fixture",
    providerID: "fixture",
    path: { cwd: "/project", root: "/project" },
    time: { created: at, completed: at + 1 },
    cost: 0,
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
  }) as never

/** A legacy session with one user request, two tasks and one refused todowrite call. */
const seed = Effect.fn("DebugTodosTest.seed")(function* () {
  const { db } = yield* Database.Service
  const sessionID = SessionID.make(`ses_debug_todos_${crypto.randomUUID().slice(0, 8)}`)
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      directory: "/project",
      title: "Debug todos",
      slug: "debug-todos",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  const user = MessageID.ascending()
  yield* db
    .insert(MessageTable)
    .values({ id: user, session_id: sessionID, data: { role: "user", time: { created: 10 }, agent: "build" } as never })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(PartTable)
    .values({
      id: PartID.ascending(),
      session_id: sessionID,
      message_id: user,
      data: { type: "text", text: "Adicione retries e rode os testes" } as never,
    })
    .run()
    .pipe(Effect.orDie)
  const todo = yield* Todo.Service
  const tasks = yield* todo.update({
    sessionID,
    todos: [
      { content: "Add retries", status: "in_progress", priority: "high", requirement: "Adicione retries" },
      { content: "Run tests", status: "pending", priority: "medium", requirement: "run the whole suite" },
    ],
  })
  const retries = tasks.find((task) => task.content === "Add retries")!
  const refused = yield* todo
    .update({ sessionID, todos: [{ id: retries.id, revision: retries.revision, status: "completed" }] })
    .pipe(Effect.flip)
  const messageID = MessageID.ascending()
  yield* db
    .insert(MessageTable)
    .values({ id: messageID, session_id: sessionID, data: assistant(20) })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(PartTable)
    .values({
      id: PartID.ascending(),
      session_id: sessionID,
      message_id: messageID,
      data: {
        type: "tool",
        tool: "todowrite",
        callID: "call_refused",
        state: {
          status: "error",
          input: { todos: [{ id: retries.id, revision: retries.revision, status: "completed" }] },
          error: `${refused.message}\nsecond line`,
          time: { start: 20, end: 21 },
        },
      } as never,
    })
    .run()
    .pipe(Effect.orDie)
  return { sessionID, retries, refused: refused.message }
})

describe("debug todos", () => {
  it.instance("reports tasks with source, criterion, revision and refusals, and recent todowrite errors", () =>
    Effect.gen(function* () {
      const { sessionID, retries, refused } = yield* seed()
      const report = yield* todoReport(sessionID)
      expect(report.tasks).toHaveLength(2)
      expect(report.tasks.find((task) => task.id === retries.id)).toMatchObject({
        status: "in_progress",
        priority: "high",
        content: "Add retries",
        revision: retries.revision,
        source: { type: "request", quote: "Adicione retries" },
        refusals: 1,
      })
      expect(report.tasks.find((task) => task.content === "Run tests")).toMatchObject({
        criterion: "run the whole suite",
        source: { paraphrase: "run the whole suite", quote: "Adicione retries e rode os testes" },
        refusals: 0,
      })
      expect(report.errors).toEqual([
        {
          time: new Date(21).toISOString(),
          kind: "evidence-refused",
          message: refused.split("\n")[0]!,
          callID: "call_refused",
        },
      ])
      expect(SessionTodoStore.refusalKind(refused)).toBe("evidence-refused")

      const text = renderTodoReport(report)
      expect(text).toContain(`session ${sessionID}`)
      expect(text).toContain(`${retries.id} r${retries.revision} [in_progress] (high) Add retries`)
      expect(text).toContain('paraphrase "run the whole suite"')
      expect(text).toContain("refused attempts: 1")
      expect(text).toContain("evidence-refused call_refused")
      expect(text).not.toContain("second line")
      // The JSON form round-trips the same report.
      expect(JSON.parse(JSON.stringify(report))).toEqual(report)
    }),
  )
})
