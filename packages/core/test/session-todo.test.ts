import { describe, expect } from "bun:test"
import { asc } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "@reddb-io/redcode-core/database/database"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { Project } from "@reddb-io/redcode-core/project"
import { ProjectTable } from "@reddb-io/redcode-core/project/sql"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { SessionV2 } from "@reddb-io/redcode-core/session"
import { SessionTable, TodoTable, TodoHistoryTable } from "@reddb-io/redcode-core/session/sql"
import { SessionTodo } from "@reddb-io/redcode-core/session/todo"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionTodo.node])))
const sessionID = SessionV2.ID.make("ses_todo_test")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "todo",
      directory: "/project",
      title: "todo",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

describe("SessionTodo", () => {
  it.live("preserves unknown and blocked tasks as unfinished without retrying known blockers", () =>
    Effect.sync(() => {
      const todos = [
        { content: "pending", status: "pending", priority: "high" },
        { content: "active", status: "in_progress", priority: "medium" },
        { content: "done", status: "completed", priority: "low" },
        { content: "cancelled", status: "cancelled", priority: "low" },
        { content: "custom", status: "waiting", priority: "low" },
        { content: "blocked", status: "blocked", priority: "low", reason: "Need credentials" },
      ]

      expect(SessionTodo.active(todos).map((todo) => todo.content)).toEqual(["pending", "active", "custom", "blocked"])
      expect(SessionTodo.reminder(todos)).toContain("[pending] pending")
      expect(SessionTodo.reminder(todos)).toContain("[in_progress] active")
      expect(
        SessionTodo.reminder(todos.filter((todo) => ["completed", "cancelled", "blocked"].includes(todo.status))),
      ).toBeUndefined()
    }),
  )

  it.effect("preserves omitted tasks, advances work and records revisions", () =>
    Effect.gen(function* () {
      yield* setup
      const todos = yield* SessionTodo.Service
      const { db } = yield* Database.Service
      const first = yield* todos.update({
        sessionID,
        todos: [
          { content: "Implement behavior", status: "in_progress", priority: "high" },
          { content: "Verify behavior", status: "pending", priority: "high" },
        ],
      })
      expect(first.map((item) => ({ ...item }))).toMatchObject([
        { id: expect.any(String), revision: 1, content: "Implement behavior", status: "in_progress" },
        { id: expect.any(String), revision: 1, content: "Verify behavior", status: "pending" },
      ])
      const next = yield* todos.update({
        sessionID,
        todos: [
          {
            id: first[0].id,
            revision: first[0].revision,
            content: "Implement behavior",
            status: "completed",
            priority: "high",
          },
        ],
      })
      expect(next).toMatchObject([
        { id: first[0].id, revision: 2, status: "completed" },
        { id: first[1].id, revision: 2, status: "in_progress" },
      ])
      expect(yield* todos.update({ sessionID, todos: [] })).toEqual(next)
      expect(yield* todos.get(sessionID)).toEqual(next)
      const history = yield* db.select().from(TodoHistoryTable).all().pipe(Effect.orDie)
      expect(history).toHaveLength(4)
      expect(history.filter((item) => item.task_id === first[0].id).map((item) => item.data.status)).toEqual([
        "in_progress",
        "completed",
      ])
    }),
  )

  it.effect("rejects cancellation without a reason, preserves blockers and resumes other work", () =>
    Effect.gen(function* () {
      yield* setup
      const todos = yield* SessionTodo.Service
      const first = yield* todos.update({
        sessionID,
        todos: [
          { content: "Deploy", status: "in_progress", priority: "high" },
          { content: "Document", status: "pending", priority: "medium" },
        ],
      })
      const item = { id: first[0].id, revision: first[0].revision, content: "Deploy", priority: "high" as const }
      expect(
        yield* todos.update({ sessionID, todos: [{ ...item, status: "cancelled" }] }).pipe(Effect.result),
      ).toMatchObject({ _tag: "Failure" })
      expect(yield* todos.get(sessionID)).toEqual(first)
      const blocked = yield* todos.update({
        sessionID,
        todos: [{ ...item, status: "blocked", reason: "Deployment credentials unavailable" }],
      })
      expect(blocked).toMatchObject([
        { status: "blocked", reason: "Deployment credentials unavailable" },
        { status: "in_progress" },
      ])
      expect(SessionTodo.active(blocked)).toHaveLength(2)
      expect(SessionTodo.reminder(blocked)).toContain("Document")
      expect(SessionTodo.reminder(blocked)).not.toContain("- [blocked] Deploy")
    }),
  )

  it.effect("accepts exact retries and rejects stale progress changes", () =>
    Effect.gen(function* () {
      yield* setup
      const todos = yield* SessionTodo.Service
      const first = yield* todos.update({
        sessionID,
        todos: [{ content: "Fix", status: "in_progress", priority: "high" }],
      })
      const change = {
        id: first[0].id,
        revision: first[0].revision,
        content: "Fix",
        status: "completed" as const,
        priority: "high" as const,
      }
      const done = yield* todos.update({ sessionID, todos: [change] })
      expect(yield* todos.update({ sessionID, todos: [change] })).toEqual(done)
      expect(
        yield* todos.update({ sessionID, todos: [{ ...change, status: "pending" }] }).pipe(Effect.result),
      ).toMatchObject({ _tag: "Failure" })
      expect(yield* todos.get(sessionID)).toEqual(done)
    }),
  )

  it.effect("keeps both changes when concurrent callers update different tasks", () =>
    Effect.gen(function* () {
      yield* setup
      const todos = yield* SessionTodo.Service
      const first = yield* todos.update({
        sessionID,
        todos: [
          { content: "A", status: "in_progress", priority: "high" },
          { content: "B", status: "pending", priority: "low" },
        ],
      })
      const snapshots: ReadonlyArray<SessionTodo.Info>[] = []
      const events = yield* EventV2.Service
      yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTodo.Event.Updated.type && Schema.is(SessionTodo.Event.Updated.data)(event.data))
            snapshots.push(event.data.todos)
        }),
      )
      yield* Effect.all(
        first.map((item) =>
          todos.update({
            sessionID,
            todos: [
              {
                content: item.content,
                status: "completed",
                priority: "high",
              },
            ],
          }),
        ),
        { concurrency: "unbounded" },
      )
      expect((yield* todos.get(sessionID)).map((item) => item.status)).toEqual(["completed", "completed"])
      expect(snapshots).toHaveLength(2)
      expect(snapshots.at(-1)).toEqual(yield* todos.get(sessionID))
    }),
  )

  it.effect("reads historical unknown states as blocked and retains original data through reconciliation", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      yield* db
        .insert(TodoTable)
        .values({ session_id: sessionID, position: 0, content: "Recover", status: "waiting", priority: "custom" })
        .run()
        .pipe(Effect.orDie)
      const todos = yield* SessionTodo.Service
      const first = yield* todos.get(sessionID)
      expect(first.map((item) => ({ ...item }))).toMatchObject([
        { status: "blocked", legacyStatus: "waiting", priority: "custom", reason: expect.stringContaining("waiting") },
      ])
      expect((yield* todos.get(sessionID))[0].id).toBe(first[0].id)
      const next = yield* todos.update({
        sessionID,
        todos: [
          { id: first[0].id, revision: first[0].revision, content: "Recover", status: "pending", priority: "medium" },
        ],
      })
      expect(next).toMatchObject([{ id: first[0].id, legacyStatus: "waiting", status: "in_progress", revision: 2 }])
      expect(
        (yield* db.select().from(TodoHistoryTable).orderBy(asc(TodoHistoryTable.revision)).all().pipe(Effect.orDie))[0]
          .data.priority,
      ).toBe("custom")
    }),
  )
  it.effect("normalizes promotion before checking retries and leaves an empty read untouched", () =>
    Effect.gen(function* () {
      yield* setup
      const todos = yield* SessionTodo.Service
      const first = yield* todos.update({
        sessionID,
        todos: [
          { content: "A", status: "pending", priority: "high" },
          { content: "B", status: "pending", priority: "high" },
        ],
      })
      expect(yield* todos.update({ sessionID, todos: [{ ...first[0], status: "pending", priority: "high" }] })).toEqual(
        first,
      )
      const move = { ...first[1], status: "in_progress" as const, priority: "high" as const }
      const next = yield* todos.update({ sessionID, todos: [move] })
      expect(next.map((item) => item.status)).toEqual(["pending", "in_progress"])
      expect(yield* todos.update({ sessionID, todos: [move] })).toEqual(next)
      expect(yield* todos.update({ sessionID, todos: [] })).toEqual(next)
    }),
  )

  it.effect("rejects invalid and duplicate writes atomically", () =>
    Effect.gen(function* () {
      yield* setup
      const todos = yield* SessionTodo.Service
      const first = yield* todos.update({
        sessionID,
        todos: [{ content: "Keep", status: "pending", priority: "high" }],
      })
      for (const incoming of [
        [{ content: " ", status: "pending" as const, priority: "high" as const }],
        [{ content: "New", status: "blocked" as const, priority: "high" as const }],
        [0, 1].map(() => ({ content: "Duplicate", status: "pending" as const, priority: "high" as const })),
        [{ id: first[0].id, content: "Keep", status: "completed" as const, priority: "high" as const }],
      ]) {
        expect(yield* todos.update({ sessionID, todos: incoming }).pipe(Effect.result)).toMatchObject({
          _tag: "Failure",
        })
        expect(yield* todos.get(sessionID)).toEqual(first)
      }
    }),
  )

  it.effect("persists continuation blockers without changing existing reasons", () =>
    Effect.gen(function* () {
      yield* setup
      const todos = yield* SessionTodo.Service
      yield* todos.update({
        sessionID,
        todos: [
          { content: "Deploy", status: "blocked", reason: "Need credentials", priority: "high" },
          { content: "Verify", status: "pending", priority: "high" },
        ],
      })
      yield* todos.block(sessionID, SessionTodo.limitReason)
      const stored = yield* todos.get(sessionID)
      expect(stored.map((item) => item.reason)).toEqual(["Need credentials", SessionTodo.limitReason])
      expect(SessionTodo.reminder(stored)).toBeUndefined()
      expect(SessionTodo.blocker(stored)).toContain(SessionTodo.limitReason)
      expect(SessionTodo.active(stored)).toHaveLength(2)
    }),
  )
})
