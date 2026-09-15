import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@reddb-io/redcode-core/database/database"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Project } from "@reddb-io/redcode-core/project"
import { ProjectTable } from "@reddb-io/redcode-core/project/sql"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { MessageTable, PartTable, SessionTable } from "@reddb-io/redcode-core/session/sql"
import { SessionTaskFacts } from "@reddb-io/redcode-core/session/task-facts"
import { SessionTodoStore } from "@reddb-io/redcode-core/session/todo-store"
import { ToolOutputBridge } from "@/tool/output-bridge"
import { TodoWriteTool } from "@/tool/todo"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Todo } from "@/session/todo"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { errorMessage } from "@/util/error"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([Todo.node, SessionTaskFacts.node, Database.node, EventV2Bridge.node, ToolOutputBridge.node]),
  ),
)

const requirement = "verify duplicate requests"

/** A legacy (v1) session with one real user request, as the TUI runtime stores it. */
const seed = Effect.fn("TodoToolTest.seed")(function* () {
  const { db } = yield* Database.Service
  const sessionID = SessionID.make(`ses_todo_tool_${crypto.randomUUID().slice(0, 8)}`)
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
      title: "Todo tool",
      slug: "todo-tool",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  const user = MessageID.ascending()
  yield* db
    .insert(MessageTable)
    .values({
      id: user,
      session_id: sessionID,
      data: { role: "user", time: { created: 10 }, agent: "build" } as never,
    })
    .run()
    .pipe(Effect.orDie)
  const text = PartID.ascending()
  yield* db
    .insert(PartTable)
    .values({
      id: text,
      session_id: sessionID,
      message_id: user,
      data: { type: "text", text: `Implement retries and ${requirement}` } as never,
    })
    .run()
    .pipe(Effect.orDie)
  return sessionID
})

/**
 * One todowrite call through the legacy runtime: an assistant message holding the running part, the
 * tool executed through its real wrapper and settled the way SessionProcessor.failToolCall records a
 * rejection (`errorMessage` of whatever the tool promise rejected with).
 */
const call = Effect.fn("TodoToolTest.call")(function* (sessionID: SessionID, todos: unknown[], at: number) {
  const { db } = yield* Database.Service
  const messageID = MessageID.ascending()
  const partID = PartID.ascending()
  const input = { todos }
  yield* db
    .insert(MessageTable)
    .values({
      id: messageID,
      session_id: sessionID,
      data: {
        role: "assistant",
        parentID: "msg_user",
        agent: "build",
        mode: "build",
        modelID: "fixture",
        providerID: "fixture",
        path: { cwd: "/project", root: "/project" },
        time: { created: at },
        cost: 0,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      } as never,
    })
    .run()
    .pipe(Effect.orDie)
  const running = { status: "running", input, time: { start: at } }
  yield* db
    .insert(PartTable)
    .values({
      id: partID,
      session_id: sessionID,
      message_id: messageID,
      data: { type: "tool", tool: "todowrite", callID: `call_${at}`, state: running } as never,
    })
    .run()
    .pipe(Effect.orDie)
  const tool = yield* Effect.flatMap(TodoWriteTool, (info) => info.init())
  const context = yield* Effect.context<never>()
  const settled = yield* Effect.promise(() =>
    Effect.runPromiseWith(context)(
      tool.execute(input as never, {
        sessionID,
        messageID,
        callID: `call_${at}`,
        agent: "build",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }),
    ).then(
      (output) => ({ output }) as const,
      (rejected: unknown) => ({ error: errorMessage(rejected) }) as const,
    ),
  )
  const state =
    "error" in settled
      ? { status: "error", input, error: settled.error, time: { start: at, end: at + 1 } }
      : {
          status: "completed",
          input,
          output: settled.output.output,
          title: settled.output.title,
          metadata: settled.output.metadata,
          time: { start: at, end: at + 1 },
        }
  yield* db
    .update(PartTable)
    .set({ data: { type: "tool", tool: "todowrite", callID: `call_${at}`, state } as never })
    .where(eq(PartTable.id, partID))
    .run()
    .pipe(Effect.orDie)
  yield* db
    .update(MessageTable)
    .set({
      data: {
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
      } as never,
    })
    .where(eq(MessageTable.id, messageID))
    .run()
    .pipe(Effect.orDie)
  return settled
})

/** Drops the session's user requests from history, the way compaction leaves a long session. */
const forgetRequests = Effect.fn("TodoToolTest.forgetRequests")(function* (sessionID: SessionID) {
  const { db } = yield* Database.Service
  const messages = yield* db
    .select()
    .from(MessageTable)
    .where(eq(MessageTable.session_id, sessionID))
    .all()
    .pipe(Effect.orDie)
  for (const message of messages) {
    if ((message.data as { role?: string }).role !== "user") continue
    yield* db.delete(PartTable).where(eq(PartTable.message_id, message.id)).run().pipe(Effect.orDie)
    yield* db.delete(MessageTable).where(eq(MessageTable.id, message.id)).run().pipe(Effect.orDie)
  }
})

/** A settled, successful bash check recorded in the legacy tables. */
const verification = Effect.fn("TodoToolTest.verification")(function* (sessionID: SessionID, at: number) {
  const { db } = yield* Database.Service
  const messageID = MessageID.ascending()
  yield* db
    .insert(MessageTable)
    .values({
      id: messageID,
      session_id: sessionID,
      data: {
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
      } as never,
    })
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
        tool: "bash",
        callID: `bash_${at}`,
        state: {
          status: "completed",
          input: { command: "bun test retries" },
          output: "2 pass",
          title: "bun test retries",
          metadata: { exit: 0 },
          time: { start: at, end: at + 1 },
        },
      } as never,
    })
    .run()
    .pipe(Effect.orDie)
  return `bash_${at}`
})

describe("tool.todowrite (legacy runtime)", () => {
  it.instance("updates an existing task, re-sending its requirement, after its request left the history", () =>
    Effect.gen(function* () {
      const sessionID = yield* seed()
      const created = yield* call(
        sessionID,
        [{ content: "Verify retries", status: "pending", priority: "high", requirement }],
        20,
      )
      if (!("output" in created)) throw new Error(`task creation failed: ${created.error}`)
      const task = created.output.metadata.todos[0]!
      yield* forgetRequests(sessionID)
      // The stored source was validated when the task was created; it is not checked again.
      const updated = yield* call(
        sessionID,
        [{ id: task.id, revision: task.revision, status: "in_progress", requirement }],
        30,
      )
      if (!("output" in updated)) throw new Error(`update refused: ${updated.error}`)
      expect(updated.output.metadata.todos[0]).toMatchObject({
        id: task.id,
        status: "in_progress",
        source: task.source,
      })
      // With no request left to link, a new requirement is still accepted and kept as the criterion.
      const unlinked = yield* call(
        sessionID,
        [{ content: "Unlinked work", status: "pending", priority: "high", requirement: "never said this" }],
        40,
      )
      if (!("output" in unlinked)) throw new Error(`unlinked requirement refused: ${unlinked.error}`)
      const stored = unlinked.output.metadata.todos.find((entry) => entry.content === "Unlinked work")
      expect(stored).toMatchObject({ criterion: "never said this" })
      expect(stored?.source).toBeUndefined()
      expect(unlinked.output.output).toContain("kept as the criterion")
    }),
  )

  it.instance("completes an existing task with fresh evidence after its request left the history", () =>
    Effect.gen(function* () {
      const sessionID = yield* seed()
      const created = yield* call(
        sessionID,
        [{ content: "Verify retries", status: "pending", priority: "high", requirement }],
        20,
      )
      if (!("output" in created)) throw new Error(`task creation failed: ${created.error}`)
      const task = created.output.metadata.todos[0]!
      yield* forgetRequests(sessionID)
      const callID = yield* verification(sessionID, 30)
      const done = yield* call(
        sessionID,
        [
          {
            id: task.id,
            revision: task.revision,
            status: "completed",
            evidence: { callID, explanation: "The retry suite passes" },
          },
        ],
        40,
      )
      if (!("output" in done)) throw new Error(`completion refused: ${done.error}`)
      expect(done.output.metadata.todos[0]).toMatchObject({
        id: task.id,
        status: "completed",
        evidence: { callID, tool: "bash" },
      })
    }),
  )

  it.instance("blocks a task after two genuine refusals recorded through the v1 error formatting", () =>
    Effect.gen(function* () {
      const sessionID = yield* seed()
      const created = yield* call(
        sessionID,
        [{ content: "Verify retries", status: "pending", priority: "high", requirement }],
        20,
      )
      if (!("output" in created)) throw new Error(`task creation failed: ${created.error}`)
      const task = created.output.metadata.todos[0]!
      const completion = { id: task.id, revision: task.revision, status: "completed" }
      const first = yield* call(sessionID, [completion], 30)
      if (!("error" in first)) throw new Error("expected the first completion to be refused")
      // What the TUI stores and shows keeps the engine's prefix, so the gate can count it.
      expect(first.error).toStartWith(SessionTodoStore.REFUSED)
      // The second genuine refusal in the turn is not returned: the gate blocks the task with it.
      const second = yield* call(sessionID, [completion], 40)
      if (!("output" in second)) throw new Error(`expected the task to block, got: ${second.error}`)
      const blocked = second.output.metadata.todos.find((entry) => entry.id === task.id)
      expect(blocked).toMatchObject({ status: "blocked" })
      expect(blocked?.reason).toContain("completion evidence could not be verified after 2 attempts")
      expect(blocked?.reason).toContain("no verification result")
      expect(second.output.output).toContain(`Task ${task.id} was blocked instead of completed`)
    }),
  )
})
