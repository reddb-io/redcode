import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@reddb-io/redcode-core/database/database"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Project } from "@reddb-io/redcode-core/project"
import { ProjectTable } from "@reddb-io/redcode-core/project/sql"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { MessageTable, PartTable, SessionTable } from "@reddb-io/redcode-core/session/sql"
import { ToolOutputBridge } from "@/tool/output-bridge"
import { SessionHistoryTool } from "@/tool/session-history"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Database.node, ToolOutputBridge.node])))

const createSession = Effect.fn("SessionHistoryTest.session")(function* (name: string) {
  const { db } = yield* Database.Service
  const sessionID = SessionID.make(`ses_history_${name}_${crypto.randomUUID().slice(0, 8)}`)
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
      title: name,
      slug: name,
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  return sessionID
})

let clock = 1_000
const insert = Effect.fn("SessionHistoryTest.insert")(function* (
  sessionID: SessionID,
  info: Record<string, unknown>,
  parts: Record<string, unknown>[],
) {
  const { db } = yield* Database.Service
  const id = MessageID.ascending()
  const created = clock++
  yield* db
    .insert(MessageTable)
    .values({ id, session_id: sessionID, time_created: created, data: { ...info, time: { created } } as never })
    .run()
    .pipe(Effect.orDie)
  for (const part of parts)
    yield* db
      .insert(PartTable)
      .values({ id: PartID.ascending(), session_id: sessionID, message_id: id, data: part as never })
      .run()
      .pipe(Effect.orDie)
  return id
})

const user = (sessionID: SessionID, text: string) =>
  insert(sessionID, { role: "user", agent: "build", model: { providerID: "test", modelID: "test" } }, [
    { type: "text", text },
  ])

const assistant = (sessionID: SessionID, parentID: MessageID, parts: Record<string, unknown>[], summary = false) =>
  insert(
    sessionID,
    {
      role: "assistant",
      parentID,
      agent: "build",
      mode: "build",
      modelID: "test",
      providerID: "test",
      path: { cwd: "/project", root: "/project" },
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
      ...(summary ? { summary: true } : {}),
    },
    parts,
  )

const run = Effect.fn("SessionHistoryTest.run")(function* (sessionID: SessionID, query: string) {
  const tool = yield* Effect.flatMap(SessionHistoryTool, (info) => info.init())
  const asked: string[] = []
  const result = yield* tool.execute({ query } as never, {
    sessionID,
    messageID: MessageID.ascending(),
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (request) => Effect.sync(() => void asked.push(request.permission)),
  })
  return { ...result, asked }
})

describe("tool.session_history", () => {
  it.instance("finds a compacted-away message by keyword, never a visible one or another session's", () =>
    Effect.gen(function* () {
      const sessionID = yield* createSession("main")
      const old = yield* user(sessionID, "Deploy uses the BLUEGREEN-TOKEN flag on staging.")
      yield* assistant(sessionID, old, [
        {
          type: "tool",
          tool: "read",
          callID: "call_1",
          state: {
            status: "completed",
            input: { filePath: "/project/deploy.yml" },
            output: "strategy: bluegreen-token rollout",
            title: "deploy.yml",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        },
      ])
      const compaction = yield* insert(
        sessionID,
        { role: "user", agent: "build", model: { providerID: "test", modelID: "test" } },
        [{ type: "compaction", auto: true }],
      )
      yield* assistant(sessionID, compaction, [{ type: "text", text: "## Objective\n- Deploy." }], true)
      const visible = yield* user(sessionID, "Still visible: BLUEGREEN-TOKEN again.")

      const other = yield* createSession("other")
      const foreign = yield* user(other, "Other session mentions BLUEGREEN-TOKEN too.")

      const result = yield* run(sessionID, "bluegreen-token")
      expect(result.asked).toEqual(["session_history"])
      expect(result.output).toContain(old)
      expect(result.output).toContain("BLUEGREEN-TOKEN flag on staging")
      expect(result.output).toContain("bluegreen-token rollout")
      expect(result.output).not.toContain(visible)
      expect(result.output).not.toContain(compaction)
      expect(result.output).not.toContain(foreign)
      expect(result.metadata.hidden).toBe(2)

      expect((yield* run(sessionID, "nothing-like-this")).output).toContain("No compacted-away message matches")
      // A session with no compaction has nothing hidden.
      expect((yield* run(other, "bluegreen-token")).output).toContain("Nothing in this session has been compacted")
    }),
  )
})
