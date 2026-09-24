import { Intelligence } from "../src/intelligence"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
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

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionTodo.node, Intelligence.node])),
)
const sessionID = SessionV2.ID.make("ses_todo_test")

const setup = Effect.gen(function* () {
  const intelligence = yield* Intelligence.Service
  const previous = yield* intelligence.read()
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        port: 0,
        fetch: async (request) => {
          const body = await request.json()
          return Response.json({
            model: "jev",
            answers: Object.fromEntries(
              Object.entries(body.questions).map(([id, question]) => [
                id,
                (question as { type: string }).type === "score"
                  ? {
                      type: "score",
                      score: 3,
                      confidence: 1,
                      probabilities: { "3": 1 },
                      legend: { "0": "Unclear", "1": "Ambiguous", "2": "Clear", "3": "Precise" },
                    }
                  : { type: "noul", noul: 0.01 },
              ]),
            ),
            usage: { input_tokens: 10, output_tokens: 0 },
          })
        },
      }),
    ),
    (server) =>
      intelligence
        .save({ settings: previous })
        .pipe(Effect.orDie, Effect.ensuring(Effect.sync(() => server.stop(true)))),
  )
  yield* intelligence.save({
    settings: {
      enabled: true,
      reasoning: "dual",
      onboarding: "completed",
      principal: { providerID: Provider.ID.make("fixture"), id: Model.ID.make("principal") },
      evaluator: { transport: "typesafe", model: "jev", baseURL: `${server.url}v1` },
    },
  })
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
  return { server }
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

  it.live("reports auto-selected evidence and blocked completions as notes for the model", () =>
    Effect.sync(() => {
      const evidence = { callID: "verify", messageID: "msg_1", tool: "bash", hash: "h", observed: 1, explanation: "ok" }
      const todos = [
        { id: "todo_a", content: "A", status: "completed", priority: "high", evidence },
        {
          id: "todo_b",
          content: "B",
          status: "blocked",
          priority: "high",
          reason: "completion evidence could not be verified after 2 attempts: none",
        },
        { id: "todo_c", content: "C", status: "completed", priority: "high", evidence },
      ]
      expect(
        SessionTodo.notes(
          [
            { id: "todo_a", revision: 1, status: "completed" },
            { id: "todo_b", revision: 1, status: "completed" },
            { content: "C", status: "completed", priority: "high", evidence: { callID: "verify", explanation: "ok" } },
            { id: "todo_a", revision: 1, status: "in_progress" },
          ],
          todos,
        ),
      ).toEqual([
        "Evidence for todo_a was selected automatically: verify (bash, message msg_1).",
        "Task todo_b was blocked instead of completed: completion evidence could not be verified after 2 attempts: none",
      ])
      expect(SessionTodo.validationHint("Missing key")).toContain('{"id":"todo_…","revision":3,"status":"completed"}')
      // Effect puts each problem's path on the line after it; the hint's first line names them all.
      const detail =
        'Expected "pending" | "in_progress" | "blocked" | "completed" | "cancelled", got "done"\n  at ["todos"][0]["status"]\nMissing key\n  at ["todos"][1]["evidence"]["callID"]\nExpected object, got 1'
      expect(SessionTodo.schemaProblems(detail)).toEqual([
        {
          path: "todos[0].status",
          problem: 'Expected "pending" | "in_progress" | "blocked" | "completed" | "cancelled", got "done"',
        },
        { path: "todos[1].evidence.callID", problem: "Missing key" },
        { path: "", problem: "Expected object, got 1" },
      ])
      expect(SessionTodo.validationHint(detail).split("\n")[0]).toBe(
        'Expected "pending" | "in_progress" | "blocked" | "completed" | "cancelled", got "done" at todos[0].status; Missing key at todos[1].evidence.callID; Expected object, got 1',
      )
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

  it.effect("stamps closedAt when a task closes and clears it on reopen", () =>
    Effect.gen(function* () {
      yield* setup
      const todos = yield* SessionTodo.Service
      const [created] = yield* todos.update({
        sessionID,
        todos: [{ content: "Close me", status: "pending", priority: "high" }],
      })
      expect(created.closedAt).toBeUndefined()
      const [done] = yield* todos.update({
        sessionID,
        todos: [{ id: created.id, revision: created.revision, status: "completed" }],
      })
      expect(typeof done.closedAt).toBe("number")
      // An exact retry keeps the stamp without churning the revision.
      const retry = yield* todos.update({
        sessionID,
        todos: [{ id: created.id, revision: done.revision, status: "completed" }],
      })
      expect(retry[0]!.closedAt).toBe(done.closedAt)
      expect(retry[0]!.revision).toBe(done.revision)
      const [reopened] = yield* todos.update({
        sessionID,
        todos: [{ id: created.id, revision: retry[0]!.revision, status: "pending" }],
      })
      expect(reopened.closedAt).toBeUndefined()
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
        [{ id: first[0].id, revision: 999, content: "Keep", status: "completed" as const, priority: "high" as const }],
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

it.live(
  "single reasoning completes tasks through structural checks while dual applies an unavailable S1 review as unverified",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const todos = yield* SessionTodo.Service
      const intelligence = yield* Intelligence.Service
      const settings = yield* intelligence.read()
      const calls = { count: 0 }
      fixture.server.reload({
        fetch: () => {
          calls.count++
          return new Response("unavailable", { status: 503 })
        },
      })
      yield* intelligence.save({ settings: { enabled: false, onboarding: "pending" } })
      const created = yield* todos.update({
        sessionID,
        todos: [{ content: "Ship the fix", criterion: "The fix is merged", priority: "high" }],
      })
      const done = yield* todos.update({
        sessionID,
        todos: [{ id: created[0].id, revision: created[0].revision, status: "completed" }],
      })
      expect(done[0]).toMatchObject({ id: created[0].id, status: "completed" })
      // Structural checks still apply in single reasoning.
      expect(
        (yield* todos
          .update({ sessionID, todos: [{ id: created[0].id, revision: 999, status: "in_progress" }] })
          .pipe(Effect.result))._tag,
      ).toBe("Failure")
      expect(calls.count).toBe(0)
      yield* intelligence.save({ settings })
      // An unavailable evaluator never freezes the task list: the update applies, labelled unverified.
      const written = yield* todos.write({
        sessionID,
        todos: [{ content: "Verify the release", criterion: "Release verified", priority: "high" }],
      })
      expect(written.todos.map((item) => item.content)).toContain("Verify the release")
      expect((yield* todos.get(sessionID)).map((item) => item.content)).toContain("Verify the release")
      expect(written.notes).toHaveLength(1)
      expect(written.notes[0]).toStartWith("Unverified: S1 review unavailable")
      expect(written.notes[0]).toContain("System One HTTP 503")
      expect(written.notes[0]).not.toContain("Previous state preserved")
      expect(calls.count).toBeGreaterThan(0)
    }),
)

it.live("an inconclusive S1 review applies the task update with an annotation", () =>
  Effect.gen(function* () {
    const fixture = yield* setup
    const todos = yield* SessionTodo.Service
    fixture.server.reload({
      fetch: async (request) => {
        const body = await request.json()
        return Response.json({
          model: "jev",
          answers: Object.fromEntries(
            Object.entries(body.questions).map(([id, question]) => [
              id,
              (question as { type: string }).type === "score"
                ? {
                    type: "score",
                    score: 2,
                    confidence: 1,
                    probabilities: { "2": 1 },
                    legend: { "0": "Unclear", "1": "Ambiguous", "2": "Clear", "3": "Precise" },
                  }
                : { type: "noul", noul: id === "coverage" ? 0.3 : 0.01 },
            ]),
          ),
          usage: { input_tokens: 10, output_tokens: 0 },
        })
      },
    })
    const written = yield* todos.write({
      sessionID,
      todos: [{ content: "Check the device", criterion: "adb lists the device", priority: "high" }],
    })
    expect(written.todos.map((item) => item.content)).toEqual(["Check the device"])
    expect(written.notes).toHaveLength(1)
    expect(written.notes[0]).toStartWith("Unverified: S1 review inconclusive")
    expect(written.notes[0]).toContain("coverage")
  }),
)

it.live("S1 refusal messages do not repeat that the previous state was preserved", () =>
  Effect.sync(() => {
    const record = {
      id: "eval_1",
      fingerprint: "f",
      sessionID: "ses_1",
      operation: "task_quality" as const,
      policy: Intelligence.POLICY,
      created: 0,
      duration: 0,
      model: "jev",
      decision: "unavailable" as const,
      answers: {},
      issues: ["Evaluation unavailable: System One HTTP 503. Previous state preserved."],
      usage: { input_tokens: 0, output_tokens: 0 },
    }
    const message = Effect.runSync(Intelligence.requireAccepted(record).pipe(Effect.flip)).message
    expect(message).toBe(
      "Semantic evaluation unavailable (eval_1): System One HTTP 503. Previous state preserved. Retry, or check S1 in /setup.",
    )
    expect(message.match(/Previous state preserved/g)).toHaveLength(1)
  }),
)

it.live("disabled intelligence and a configuration change during evaluation preserve task revisions", () =>
  Effect.gen(function* () {
    const fixture = yield* setup
    const todos = yield* SessionTodo.Service
    const intelligence = yield* Intelligence.Service
    const settings = yield* intelligence.read()
    const initial = yield* todos.update({
      sessionID,
      todos: [{ content: "Preserve filters", criterion: "Filters survive pagination", priority: "high" }],
    })
    yield* intelligence.save({ settings: { ...settings, enabled: false } })
    expect(
      (yield* todos
        .update({ sessionID, todos: [{ id: initial[0].id, content: "Revise filters" }] })
        .pipe(Effect.result))._tag,
    ).toBe("Failure")
    yield* intelligence.save({ settings })
    fixture.server.reload({
      fetch: async (request) => {
        const body = await request.json()
        await Effect.runPromise(intelligence.save({ settings: { ...settings, enabled: false } }))
        return Response.json({
          model: "jev",
          answers: Object.fromEntries(
            Object.entries(body.questions).map(([id, question]) => [
              id,
              (question as { type: string }).type === "score"
                ? {
                    type: "score",
                    score: 3,
                    confidence: 1,
                    probabilities: { "3": 1 },
                    legend: { "0": "Unclear", "1": "Ambiguous", "2": "Clear", "3": "Precise" },
                  }
                : { type: "noul", noul: 0.01 },
            ]),
          ),
          usage: { input_tokens: 10, output_tokens: 0 },
        })
      },
    })
    expect(
      (yield* todos
        .update({ sessionID, todos: [{ id: initial[0].id, content: "Revise filters" }] })
        .pipe(Effect.result))._tag,
    ).toBe("Failure")
    expect(yield* todos.get(sessionID)).toEqual(initial)
    expect((yield* intelligence.history(sessionID))[0]?.decision).toBe("accepted")
  }),
)

it.live("semantic rejection preserves the stored task revision", () =>
  Effect.gen(function* () {
    yield* setup
    const todos = yield* SessionTodo.Service
    const intelligence = yield* Intelligence.Service
    const previous = yield* intelligence.read()
    const initial = yield* todos.update({
      sessionID,
      todos: [{ content: "Preserve filters", criterion: "Filters survive pagination", priority: "high" }],
    })
    const calls: unknown[] = []
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const body = await request.json()
        calls.push(body)
        return Response.json({
          model: "jev-1.13.0",
          answers: Object.fromEntries(
            Object.entries(body.questions).map(([key, question]) => [
              key,
              (question as { type: string }).type === "score"
                ? {
                    type: "score",
                    score: 2,
                    confidence: 1,
                    probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 },
                    legend: { "0": "Unclear", "1": "Ambiguous", "2": "Clear", "3": "Precise" },
                  }
                : { type: "noul", noul: 0.99 },
            ]),
          ),
          usage: { input_tokens: 10, output_tokens: 2 },
        })
      },
    })
    yield* Effect.gen(function* () {
      yield* intelligence.save({
        settings: {
          enabled: true,
          reasoning: "dual",
          onboarding: "completed",
          principal: { id: Model.ID.make("main"), providerID: Provider.ID.make("test") },
          evaluator: { transport: "red-router", baseURL: `${server.url}v1`, model: "jev-1.13.0" },
        },
      })
      const malformed = yield* todos
        .update({ sessionID, todos: [{ id: "missing", status: "completed" }] })
        .pipe(Effect.result)
      expect(malformed._tag).toBe("Failure")
      expect(calls).toHaveLength(0)
      const result = yield* todos
        .update({ sessionID, todos: [{ id: initial[0].id, content: "Delete filters" }] })
        .pipe(Effect.result)
      expect(result._tag).toBe("Failure")
      expect(yield* todos.get(sessionID)).toEqual(initial)
      expect(calls).toHaveLength(1)
      expect((yield* intelligence.history(sessionID))[0]?.decision).toBe("needs_revision")
    }).pipe(
      Effect.ensuring(intelligence.save({ settings: previous }).pipe(Effect.orDie)),
      Effect.ensuring(Effect.sync(() => server.stop(true))),
    )
  }),
)
