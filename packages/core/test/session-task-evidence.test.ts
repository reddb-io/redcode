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
import { SessionTodoStore } from "@reddb-io/redcode-core/session/todo-store"
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
const result = (
  name: string,
  callID: string,
  completed: number,
  exit = 0,
  status = "completed",
  input: Record<string, unknown> = { command: "bun test" },
  messageID = `msg_result_${callID}_${completed}`,
  seq = completed,
  error = "Partial edit failed",
) =>
  message(
    {
      id: messageID,
      type: "assistant",
      agent: "build",
      model: { id: "fixture", providerID: "fixture" },
      time: { created: completed },
      content: [
        {
          type: "tool",
          id: callID,
          name,
          time: { created: completed - 1, ...(status === "pending" ? {} : { completed }) },
          state:
            status === "pending"
              ? { status, input: JSON.stringify(input) }
              : {
                  status,
                  input,
                  structured: { exit },
                  content: [{ type: "text", text: exit ? "Failed" : "Passed" }],
                  ...(status === "error" ? { error: { type: "unknown", message: error } } : {}),
                },
        },
      ],
    },
    seq,
  )
/** A todowrite call the runtime recorded as failed with `error`. */
const refusal = (callID: string, completed: number, todo: unknown, error: string) =>
  result("todowrite", callID, completed, 0, "error", { todos: [todo] }, undefined, undefined, error)
/** An assistant message the runtime closed (a crashed or aborted turn) with a tool part still pending. */
const abandoned = (name: string, callID: string, created: number, input: Record<string, unknown>) =>
  message(
    {
      id: `msg_abandoned_${callID}`,
      type: "assistant",
      agent: "build",
      model: { id: "fixture", providerID: "fixture" },
      time: { created, completed: created + 1 },
      error: { type: "unknown", message: "The turn was abandoned" },
      content: [
        {
          type: "tool",
          id: callID,
          name,
          time: { created },
          state: { status: "pending", input: JSON.stringify(input) },
        },
      ],
    },
    created,
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
    yield* result("bash", "reused", 25, 1)
    const todos = yield* SessionTodo.Service
    const evidence = { callID: "reused", explanation: "Tests passed" }
    // Neither match succeeded: the refusal names both messages so the model can disambiguate.
    const ambiguous = yield* todos
      .update({ sessionID, todos: [{ ...task, status: "completed", evidence }] })
      .pipe(Effect.flip)
    expect(ambiguous.message).toContain("matches 2 results")
    expect(ambiguous.message).toContain("msg_result_reused_25")
    yield* result("bash", "reused", 30)
    // A reused callID with one successful match after the request resolves to that match.
    const auto = yield* todos.update({ sessionID, todos: [{ ...task, status: "completed", evidence }] })
    expect(auto[0].evidence?.messageID).toBe("msg_result_reused_30")
    const done = yield* todos.update({
      sessionID,
      todos: [
        {
          ...task,
          id: auto[0].id,
          revision: auto[0].revision,
          status: "completed",
          evidence: { ...evidence, messageID: "msg_result_reused_30" },
        },
      ],
    })
    expect(done[0].evidence?.messageID).toBe("msg_result_reused_30")
    yield* result("edit", "reused", 40)
    expect((yield* todos.review(sessionID))[0].status).toBe("in_progress")
  }),
)

it.effect("selects the newest successful result when evidence is omitted and explains from the task itself", () =>
  Effect.gen(function* () {
    yield* setup
    yield* request()
    yield* result("read", "read-1", 20, 0, "completed", { filePath: "/project/a.ts" })
    yield* result("edit", "edit-1", 30, 0, "completed", { filePath: "/project/a.ts" })
    yield* result("bash", "verify-1", 40)
    yield* result("read", "read-2", 50, 0, "completed", { filePath: "/project/a.ts" })
    const todos = yield* SessionTodo.Service
    const done = yield* todos.update({ sessionID, todos: [{ ...task, status: "completed" }] })
    // The verification outranks the later read, and the criterion stands in for the explanation.
    expect(done[0].evidence).toMatchObject({ callID: "verify-1", tool: "bash", explanation: task.criterion })
    yield* result("bash", "verify-2", 60)
    const bare = yield* todos.update({
      sessionID,
      todos: [{ id: done[0].id, revision: done[0].revision, status: "in_progress" }],
    })
    expect(
      (yield* todos.update({
        sessionID,
        todos: [{ id: bare[0].id, revision: bare[0].revision, status: "completed" }],
      }))[0].evidence,
    ).toMatchObject({ callID: "verify-2", explanation: "auto-selected latest verification bash" })
    const facts = yield* SessionTaskFacts.Service
    expect((yield* facts.load(sessionID)).results.find((entry) => entry.callID === "edit-1")).toMatchObject({
      kind: "edit",
      paths: ["/project/a.ts"],
    })
  }),
)

it.effect("keeps evidence valid across later verification commands and edits to other files", () =>
  Effect.gen(function* () {
    yield* setup
    yield* request()
    yield* result("read", "read-a", 20, 0, "completed", { filePath: "/project/a.ts" })
    const todos = yield* SessionTodo.Service
    const done = yield* todos.update({
      sessionID,
      todos: [{ ...task, status: "completed", evidence: { callID: "read-a", explanation: "Retry loop is present" } }],
    })
    expect(done[0].status).toBe("completed")
    // A verification command after the proof is not an invalidating action.
    yield* result("bash", "check", 30)
    expect(yield* todos.review(sessionID)).toEqual(done)
    // Neither is an edit that touches a different file.
    yield* result("edit", "edit-b", 40, 0, "completed", { filePath: "/project/b.ts" })
    expect(yield* todos.review(sessionID)).toEqual(done)
    // A shell action in the same millisecond as the proof used to count as later; only strictly later edits do.
    yield* result("write", "write-c", 20, 0, "completed", { filePath: "/project/a.ts" }, "msg_same_tick", 41)
    expect(yield* todos.review(sessionID)).toEqual(done)
    // Editing the proof's own file again is what reopens it.
    yield* result("edit", "edit-a-again", 50, 0, "completed", { filePath: "/project/a.ts" })
    const reopened = (yield* todos.review(sessionID))[0]
    expect(reopened.status).toBe("in_progress")
    expect(reopened.evidence).toBeUndefined()
    // A patch names its files in the patch text.
    const facts = yield* SessionTaskFacts.Service
    yield* result("apply_patch", "patch", 60, 0, "completed", {
      patchText: "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** Add File: src/new.ts\n+z\n*** End Patch",
    })
    expect((yield* facts.load(sessionID)).results.find((entry) => entry.callID === "patch")?.paths).toEqual([
      "src/a.ts",
      "src/new.ts",
    ])
  }),
)

it.effect("ignores still-running siblings of the message issuing the update and remains conservative without it", () =>
  Effect.gen(function* () {
    yield* setup
    yield* request()
    yield* result("bash", "verify", 20)
    yield* result("edit", "streaming", 21, 0, "pending", { filePath: "/project/a.ts" }, "msg_current")
    const todos = yield* SessionTodo.Service
    const evidence = { callID: "verify", explanation: "Passed" }
    const refused = yield* todos
      .update({ sessionID, todos: [{ ...task, status: "completed", evidence }] })
      .pipe(Effect.flip)
    expect(refused.message).toContain("still running")
    const done = yield* todos.update({
      sessionID,
      messageID: "msg_current",
      todos: [{ ...task, status: "completed", evidence }],
    })
    expect(done[0]).toMatchObject({ status: "completed", evidence: { callID: "verify" } })
  }),
)

it.effect("spells out missing, unknown and stale evidence with the candidates inline", () =>
  Effect.gen(function* () {
    yield* setup
    yield* result("bash", "old", 5)
    yield* request()
    const todos = yield* SessionTodo.Service
    const attempt = (evidence?: { callID: string; explanation: string }) =>
      todos
        .update({ sessionID, todos: [{ ...task, status: "completed", ...(evidence ? { evidence } : {}) }] })
        .pipe(Effect.flip)
    expect((yield* attempt()).message).toContain("no verification result")
    expect((yield* attempt()).message).toContain("msg_request_10")
    expect((yield* attempt()).message).toContain("old (bash, verification, message msg_result_old_5, succeeded")
    expect((yield* attempt({ callID: "invented", explanation: "x" })).message).toContain(
      'callID "invented" does not match',
    )
    yield* result("bash", "failed", 20, 1)
    expect((yield* attempt({ callID: "old", explanation: "x" })).message).toContain("before the request msg_request_10")
    const later = yield* attempt({ callID: "failed", explanation: "x" })
    expect(later.message).toContain('callID "failed" (bash) is a failed result')
    expect(later.message).toContain("failed (bash, verification, message msg_result_failed_20, failed")
    yield* result("bash", "verify", 30)
    yield* result("edit", "late", 40, 0, "error", { filePath: "/project/a.ts" })
    const stale = yield* attempt({ callID: "verify", explanation: "x" })
    expect(stale.message).toContain('callID "verify" (bash')
    expect(stale.message).toContain("later edit late (edit, /project/a.ts")
  }),
)

it.effect("blocks a task after two consecutive failed completion attempts in the same turn", () =>
  Effect.gen(function* () {
    yield* setup
    yield* request()
    const todos = yield* SessionTodo.Service
    const created = (yield* todos.update({ sessionID, todos: [task] }))[0]
    const completion = { id: created.id, revision: created.revision, status: "completed" as const }
    const first = yield* todos.update({ sessionID, todos: [completion] }).pipe(Effect.flip)
    expect(first.message).toContain("no verification result")
    // The runtime records the refused call; a success in between resets the count.
    yield* refusal("attempt-1", 20, completion, first.message)
    yield* result("todowrite", "progress", 21, 0, "completed", { todos: [{ ...completion, status: "in_progress" }] })
    const second = yield* todos.update({ sessionID, todos: [completion] }).pipe(Effect.flip)
    expect(second.message).toContain("no verification result")
    yield* refusal("attempt-2", 22, completion, second.message)
    const blocked = yield* todos.update({ sessionID, todos: [completion] })
    expect(blocked[0]).toMatchObject({ status: "blocked", revision: created.revision! + 1 })
    expect(blocked[0].reason).toContain("completion evidence could not be verified after 2 attempts")
    expect(blocked[0].reason).toContain("no verification result")
    expect(SessionTodo.reminder(blocked)).toBeUndefined()
    // Once the failure is on a previous turn it no longer counts.
    yield* refusal("attempt-3", 25, completion, second.message)
    yield* request("Try again", 30)
    const unblocked = yield* todos.update({
      sessionID,
      todos: [{ id: created.id, revision: blocked[0].revision, status: "in_progress" }],
    })
    expect(unblocked[0]).toMatchObject({ status: "in_progress", content: task.content, priority: task.priority })
    expect(
      (yield* todos
        .update({ sessionID, todos: [{ id: created.id, revision: unblocked[0].revision, status: "completed" }] })
        .pipe(Effect.flip)).message,
    ).toContain("no verification result")
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

it.effect("refuses a cited failing check instead of substituting another successful result", () =>
  Effect.gen(function* () {
    yield* setup
    yield* request()
    yield* result("edit", "edit-a", 20, 0, "completed", { filePath: "/project/a.ts" })
    yield* result("bash", "tests", 30, 1)
    const todos = yield* SessionTodo.Service
    const cite = (callID: string) =>
      todos
        .update({ sessionID, todos: [{ ...task, status: "completed", evidence: { callID, explanation: "Passed" } }] })
        .pipe(Effect.flip)
    const failed = yield* cite("tests")
    expect(failed.message).toStartWith(SessionTodoStore.REFUSED)
    expect(failed.message).toContain('callID "tests" (bash) is a failed result')
    // A passing check elsewhere does not rescue an unknown, stale or superseded citation either.
    yield* result("bash", "old-check", 5)
    yield* result("bash", "passing", 40)
    expect((yield* cite("invented")).message).toContain('callID "invented" does not match')
    expect((yield* cite("old-check")).message).toContain("before the request msg_request_10")
    yield* result("edit", "edit-b", 50, 0, "completed", { filePath: "/project/b.ts" })
    yield* result("bash", "later-pass", 60)
    expect((yield* cite("passing")).message).toContain("predates a later edit edit-b")
    expect((yield* cite("edit-a")).message).toContain("is the edit itself")
  }),
)

it.effect("selects only verification results on the model's behalf and accepts cited reads for investigation", () =>
  Effect.gen(function* () {
    yield* setup
    yield* request()
    yield* result("edit", "edit-a", 20, 0, "completed", { filePath: "/project/a.ts" })
    const todos = yield* SessionTodo.Service
    const created = (yield* todos.update({ sessionID, todos: [task] }))[0]
    const bare = yield* todos
      .update({ sessionID, todos: [{ id: created.id, revision: created.revision, status: "completed" }] })
      .pipe(Effect.flip)
    expect(bare.message).toContain("no verification result")
    expect(bare.message).toContain("edit-a (edit, edit")
    expect(bare.message).toContain("cite the read, grep or other result")
    // A read after the edit is not selected either: it proves nothing about the change working.
    yield* result("read", "read-a", 30, 0, "completed", { filePath: "/project/a.ts" })
    expect(
      (yield* todos
        .update({ sessionID, todos: [{ id: created.id, revision: created.revision, status: "completed" }] })
        .pipe(Effect.flip)).message,
    ).toContain("read-a (read, other")
    // A verification that predates the last overlapping edit is not a candidate.
    yield* result("bash", "early", 25)
    yield* result("edit", "edit-late", 35, 0, "completed", { filePath: "/project/a.ts" })
    expect(
      (yield* todos
        .update({ sessionID, todos: [{ id: created.id, revision: created.revision, status: "completed" }] })
        .pipe(Effect.flip)).message,
    ).toContain("no verification result")
  }),
)

it.effect("completes an exploration task from a cited read with its explanation", () =>
  Effect.gen(function* () {
    yield* setup
    yield* request("Explore the current Leads table in the code")
    yield* result("grep", "grep-leads", 20, 0, "completed", { pattern: "LeadsTable", path: "/project/src" })
    yield* result("read", "read-leads", 30, 0, "completed", { filePath: "/project/src/leads/table.tsx" })
    const todos = yield* SessionTodo.Service
    const explore = {
      content: "Explore the Leads table",
      requirement: "Explore the current Leads table",
      status: "completed" as const,
      priority: "high" as const,
    }
    const done = yield* todos.update({
      sessionID,
      todos: [
        {
          ...explore,
          evidence: { callID: "read-leads", explanation: "table.tsx renders the columns, sorting and row actions" },
        },
      ],
    })
    expect(done[0]).toMatchObject({ status: "completed", evidence: { callID: "read-leads", tool: "read" } })
    // An edit elsewhere leaves it standing; editing the explored file reopens it.
    yield* result("edit", "edit-other", 40, 0, "completed", { filePath: "/project/src/other.ts" })
    expect((yield* todos.review(sessionID))[0].status).toBe("completed")
    yield* result("edit", "edit-table", 50, 0, "completed", { filePath: "/project/src/leads/table.tsx" })
    expect((yield* todos.review(sessionID))[0].status).toBe("in_progress")
    // A grep over a directory is invalidated by an edit beneath it.
    const facts = yield* SessionTaskFacts.Service
    const observed = yield* facts.load(sessionID)
    const grep = observed.results.find((entry) => entry.callID === "grep-leads")!
    expect(SessionTaskFacts.overlaps(["/project/src/leads/table.tsx"], grep.paths)).toBe(true)
  }),
)

it.effect("auto-selects a design preview and lets a later design edit invalidate it", () =>
  Effect.gen(function* () {
    yield* setup
    yield* request()
    yield* result("design_preview", "preview-1", 20, 0, "completed", { id: "des_1" })
    const todos = yield* SessionTodo.Service
    const done = yield* todos.update({ sessionID, todos: [{ ...task, status: "completed" }] })
    expect(done[0].evidence).toMatchObject({ callID: "preview-1", tool: "design_preview" })
    yield* request("Now implement retries and verify duplicate requests again", 30)
    yield* result("design_preview", "preview-2", 40, 0, "completed", { id: "des_1" })
    yield* result("design_edit", "design-edit", 50, 0, "completed", { id: "des_1" })
    const again = { ...task, content: "Verify retries again", requirement: "verify duplicate requests again" }
    const stale = yield* todos
      .update({
        sessionID,
        todos: [{ ...again, status: "completed", evidence: { callID: "preview-2", explanation: "Preview matches" } }],
      })
      .pipe(Effect.flip)
    expect(stale.message).toContain("predates a later edit design-edit (design_edit")
    expect(
      (yield* todos.update({ sessionID, todos: [{ ...again, status: "completed" }] }).pipe(Effect.flip)).message,
    ).toContain("no verification result")
    for (const tool of ["design_edit", "design_generate", "design_asset"])
      expect(SessionTaskFacts.kind(tool)).toBe("edit")
  }),
)

it.effect("settles tool parts abandoned in a closed message so they neither invalidate nor stay running", () =>
  Effect.gen(function* () {
    yield* setup
    yield* request()
    yield* abandoned("edit", "crashed-edit", 15, { filePath: "/project/a.ts" })
    yield* result("bash", "verify", 30)
    const todos = yield* SessionTodo.Service
    const done = yield* todos.update({
      sessionID,
      todos: [{ ...task, status: "completed", evidence: { callID: "verify", explanation: "Passed" } }],
    })
    expect(done[0]).toMatchObject({ status: "completed", evidence: { callID: "verify" } })
    // A crash after the proof leaves the completion standing on review.
    yield* abandoned("edit", "crashed-later", 40, { filePath: "/project/a.ts" })
    expect(yield* todos.review(sessionID)).toEqual(done)
    const facts = yield* SessionTaskFacts.Service
    expect((yield* facts.load(sessionID)).results.find((entry) => entry.callID === "crashed-later")).toMatchObject({
      abandoned: true,
      settled: true,
      errored: true,
      successful: false,
    })
    // Citing the abandoned part itself is refused with that reason.
    expect(
      (yield* todos
        .update({
          sessionID,
          todos: [
            {
              ...task,
              content: "Other",
              status: "completed",
              evidence: { callID: "crashed-later", explanation: "x" },
            },
          ],
        })
        .pipe(Effect.flip)).message,
    ).toContain("never finished")
    // An unsettled edit in a message that is still open still counts against review.
    yield* result("edit", "in-flight", 50, 0, "pending", { filePath: "/project/a.ts" }, "msg_open")
    expect((yield* todos.review(sessionID))[0].status).toBe("in_progress")
  }),
)

it.effect("counts only genuine evidence refusals toward blocking a task", () =>
  Effect.gen(function* () {
    yield* setup
    yield* request()
    const todos = yield* SessionTodo.Service
    const created = (yield* todos.update({ sessionID, todos: [task] }))[0]
    const completion = { id: created.id, revision: created.revision, status: "completed" as const }
    const refused = (yield* todos.update({ sessionID, todos: [completion] }).pipe(Effect.flip)).message
    // A malformed call and a loop-guard correction quoting a refusal are not evidence refusals.
    yield* refusal(
      "malformed",
      20,
      { id: created.id, status: "completed", evidence: {} },
      "Invalid task update: Missing key",
    )
    yield* refusal(
      "guard",
      21,
      completion,
      `This is call 3 of \`todowrite\`, and every one of them failed with the same error.\nresult: ${refused}`,
    )
    // So this is still the first genuine refusal: refused again, not blocked.
    const second = yield* todos.update({ sessionID, todos: [completion] }).pipe(Effect.flip)
    expect(second.message).toStartWith(SessionTodoStore.REFUSED)
    // Recorded (as the runtime's error formatting may wrap it), the next refusal is the second one.
    yield* refusal("real-1", 22, completion, `Error: ${second.message}`)
    const blocked = yield* todos.update({ sessionID, todos: [completion] })
    expect(blocked[0].status).toBe("blocked")
    expect(blocked[0].reason).toContain("after 2 attempts")
  }),
)
