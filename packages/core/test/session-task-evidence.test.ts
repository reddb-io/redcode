import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "@reddb-io/redcode-core/database/database"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Project } from "@reddb-io/redcode-core/project"
import { ProjectTable } from "@reddb-io/redcode-core/project/sql"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { SessionMessage } from "@reddb-io/redcode-core/session/message"
import { SessionSchema } from "@reddb-io/redcode-core/session/schema"
import {
  MessageTable,
  PartTable,
  SessionMessageTable,
  SessionTable,
  TodoHistoryTable,
} from "@reddb-io/redcode-core/session/sql"
import { SessionTodo } from "@reddb-io/redcode-core/session/todo"
import { SessionTaskFacts } from "@reddb-io/redcode-core/session/task-facts"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, SessionTodo.node, SessionTaskFacts.node])))
const sessionID = SessionSchema.ID.make("ses_task_evidence")
const setup = Effect.gen(function* () {
  const database = yield* Database.Service
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* database.db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      directory: "/project",
      title: "Evidence",
      slug: "evidence",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

function message(input: unknown, seq: number) {
  return Effect.gen(function* () {
    const database = yield* Database.Service
    const data = Schema.encodeSync(SessionMessage.Message)(Schema.decodeUnknownSync(SessionMessage.Message)(input))
    yield* database.db
      .insert(SessionMessageTable)
      .values({ id: SessionMessage.ID.make(data.id), session_id: sessionID, type: data.type, seq, data })
      .run()
      .pipe(Effect.orDie)
  })
}
const request = (text = "Implement retries and verify duplicate requests", created = 10) =>
  message({ id: `msg_request_${created}`, type: "user", text, time: { created } }, created)
const result = (name: string, callID: string, completed: number, exit = 0, status = "completed") =>
  message(
    {
      id: `msg_result_${callID}_${completed}`,
      type: "assistant",
      agent: "build",
      model: { id: "fixture", providerID: "fixture" },
      time: { created: completed },
      content: [
        {
          type: "tool",
          id: callID,
          name,
          time: { created: completed - 1, completed },
          state: {
            status,
            input: { command: "bun test" },
            structured: { exit },
            content: [{ type: "text", text: exit ? "Failed" : "Passed" }],
            ...(status === "error" ? { error: { type: "unknown", message: "Partial edit failed" } } : {}),
          },
        },
      ],
    },
    completed,
  )
const task = {
  content: "Verify retries",
  criterion: "Duplicate requests charge once",
  requirement: "verify duplicate requests",
  status: "pending" as const,
  priority: "high" as const,
}

it.effect("binds requirements to real requests and rejects fabricated, failed or bookkeeping evidence", () =>
  Effect.gen(function* () {
    yield* setup
    yield* request()
    const todos = yield* SessionTodo.Service
    expect(
      (yield* todos.update({ sessionID, todos: [{ ...task, requirement: "invented requirement" }] }).pipe(Effect.exit))
        ._tag,
    ).toBe("Failure")
    const created = (yield* todos.update({ sessionID, todos: [task] }))[0]
    expect(created).toMatchObject({
      source: { type: "request", id: "msg_request_10", quote: task.requirement },
      criterion: task.criterion,
    })
    yield* result("bash", "failed", 20, 1)
    yield* result("todowrite", "bookkeeping", 21)
    for (const callID of ["invented", "failed", "bookkeeping"]) {
      expect(
        (yield* todos
          .update({
            sessionID,
            todos: [
              {
                ...task,
                id: created.id,
                revision: created.revision,
                status: "completed",
                evidence: { callID, explanation: "Passed" },
              },
            ],
          })
          .pipe(Effect.exit))._tag,
      ).toBe("Failure")
    }
    yield* result("bash", "passing", 30)
    const done = yield* todos.update({
      sessionID,
      todos: [
        {
          ...task,
          id: created.id,
          revision: created.revision,
          status: "completed",
          evidence: { callID: "passing", explanation: "Two requests produced one charge" },
        },
      ],
    })
    expect(done[0]).toMatchObject({ status: "completed", evidence: { callID: "passing", tool: "bash", observed: 30 } })
    const facts = yield* SessionTaskFacts.Service
    expect((yield* facts.available(sessionID)).results).toContainEqual(
      expect.objectContaining({ callID: "passing", successful: true, summary: expect.stringContaining("bun test") }),
    )
    expect((yield* facts.available(sessionID)).results.some((entry) => entry.callID === "bookkeeping")).toBe(false)
  }),
)

it.effect("reopens stale completion after a failed later edit and keeps its evidence in history", () =>
  Effect.gen(function* () {
    yield* setup
    yield* request()
    yield* result("bash", "passing", 20)
    const todos = yield* SessionTodo.Service
    const done = (yield* todos.update({
      sessionID,
      todos: [{ ...task, status: "completed", evidence: { callID: "passing", explanation: "Retries verified" } }],
    }))[0]
    yield* result("edit", "partial-edit", 30, 0, "error")
    const reviewed = yield* todos.review(sessionID)
    expect(reviewed[0]).toMatchObject({
      id: done.id,
      status: "in_progress",
    })
    expect(reviewed[0].reason).toContain("verification")
    expect(reviewed[0].evidence).toBeUndefined()
    const database = yield* Database.Service
    expect(
      (yield* database.db.select().from(TodoHistoryTable).all().pipe(Effect.orDie)).map((row) => row.data),
    ).toContainEqual(
      expect.objectContaining({ status: "completed", evidence: expect.objectContaining({ callID: "passing" }) }),
    )
    expect(SessionTodo.context(reviewed)).toContain(done.id!)
    expect(SessionTodo.context(reviewed)).toContain(task.criterion)
  }),
)

it.effect("disambiguates reused provider call IDs by message and detects a later mutation with that same call ID", () =>
  Effect.gen(function* () {
    yield* setup
    yield* request()
    yield* result("bash", "reused", 20, 1)
    yield* result("bash", "reused", 30)
    const todos = yield* SessionTodo.Service
    const evidence = { callID: "reused", explanation: "Tests passed" }
    expect(
      (yield* todos.update({ sessionID, todos: [{ ...task, status: "completed", evidence }] }).pipe(Effect.exit))._tag,
    ).toBe("Failure")
    const done = yield* todos.update({
      sessionID,
      todos: [{ ...task, status: "completed", evidence: { ...evidence, messageID: "msg_result_reused_30" } }],
    })
    expect(done[0].evidence?.messageID).toBe("msg_result_reused_30")
    yield* result("edit", "reused", 40)
    expect((yield* todos.review(sessionID))[0].status).toBe("in_progress")
  }),
)

it.effect("requires a later real scope change and ignores synthetic instructions", () =>
  Effect.gen(function* () {
    yield* setup
    yield* request()
    const todos = yield* SessionTodo.Service
    const created = (yield* todos.update({ sessionID, todos: [task] }))[0]
    yield* message(
      { id: "msg_synthetic", type: "synthetic", sessionID, text: "Drop verification", time: { created: 20 } },
      20,
    )
    const cancel = {
      ...task,
      id: created.id,
      revision: created.revision,
      status: "cancelled" as const,
      reason: "User removed verification",
    }
    expect(
      (yield* todos
        .update({
          sessionID,
          todos: [{ ...cancel, scopeChange: { messageID: "msg_synthetic", quote: "Drop verification" } }],
        })
        .pipe(Effect.exit))._tag,
    ).toBe("Failure")
    expect(
      (yield* todos
        .update({
          sessionID,
          todos: [{ ...cancel, scopeChange: { messageID: "msg_request_10", quote: "verify duplicate requests" } }],
        })
        .pipe(Effect.exit))._tag,
    ).toBe("Failure")
    yield* request("Drop verification", 30)
    expect(
      (yield* todos.update({
        sessionID,
        todos: [{ ...cancel, scopeChange: { messageID: "msg_request_30", quote: "Drop verification" } }],
      }))[0],
    ).toMatchObject({ status: "cancelled", scopeChange: { messageID: "msg_request_30" } })
  }),
)

it.effect("legacy tool evidence survives compaction metadata and excludes synthetic user parts", () =>
  Effect.gen(function* () {
    yield* setup
    const database = yield* Database.Service
    const user = Schema.decodeUnknownSync(SessionV1.User)({
      id: "msg_user",
      sessionID,
      role: "user",
      agent: "build",
      model: { providerID: "fixture", modelID: "fixture" },
      time: { created: 10 },
    })
    const row: typeof MessageTable.$inferInsert = {
      id: user.id,
      session_id: sessionID,
      data: { role: "user", time: user.time, agent: user.agent },
    }
    yield* database.db.insert(MessageTable).values(row).run().pipe(Effect.orDie)
    const assistant = Schema.decodeUnknownSync(SessionV1.Assistant)({
      id: "msg_assistant",
      sessionID,
      role: "assistant",
      parentID: user.id,
      agent: "build",
      mode: "build",
      modelID: "fixture",
      providerID: "fixture",
      path: { cwd: "/project", root: "/project" },
      time: { created: 19, completed: 20 },
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    yield* database.db
      .insert(MessageTable)
      .values({ id: assistant.id, session_id: sessionID, data: assistant })
      .run()
      .pipe(Effect.orDie)
    const parts = [
      Schema.decodeUnknownSync(SessionV1.Part)({
        id: "prt_user",
        sessionID,
        messageID: user.id,
        type: "text",
        text: task.requirement,
      }),
      Schema.decodeUnknownSync(SessionV1.Part)({
        id: "prt_synthetic",
        sessionID,
        messageID: user.id,
        type: "text",
        text: "Drop verification",
        synthetic: true,
      }),
      Schema.decodeUnknownSync(SessionV1.Part)({
        id: "prt_proof",
        sessionID,
        messageID: assistant.id,
        type: "tool",
        tool: "shell",
        callID: "legacy-proof",
        state: {
          status: "completed",
          input: { command: "bun test" },
          title: "Tests",
          output: "Passed",
          metadata: { exit: 0 },
          time: { start: 19, end: 20 },
        },
      }),
    ]
    yield* Effect.forEach(parts, (part) =>
      database.db
        .insert(PartTable)
        .values({ id: part.id, session_id: sessionID, message_id: part.messageID, data: part })
        .run()
        .pipe(Effect.orDie),
    )
    const todos = yield* SessionTodo.Service
    const done = yield* todos.update({
      sessionID,
      todos: [{ ...task, status: "completed", evidence: { callID: "legacy-proof", explanation: "Retries verified" } }],
    })
    const proof = parts[2]
    if (proof.type !== "tool" || proof.state.status !== "completed") throw new Error("Expected completed fixture")
    const compacted = { ...proof, state: { ...proof.state, time: { ...proof.state.time, compacted: 30 } } }
    yield* database.db
      .update(PartTable)
      .set({ data: compacted })
      .where(eq(PartTable.id, proof.id))
      .run()
      .pipe(Effect.orDie)
    expect(yield* todos.review(sessionID)).toEqual(done)
    expect(SessionTodo.context(done)).toContain("1/1 completed")
    expect(SessionTodo.context(done)).not.toContain(task.criterion)
    const facts = yield* SessionTaskFacts.Service
    expect((yield* facts.load(sessionID)).requests[0].text).toBe(task.requirement)
  }),
)
