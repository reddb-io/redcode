import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Project } from "@opencode/core/project"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { ClaudeCodeImport } from "@opencode/core/session/import/claude-code"
import { SessionImport } from "@opencode/core/session/import/service"
import { ImportSource } from "@opencode/core/session/import/source"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTransfer } from "@opencode/core/session/transfer"
import { ToolInterrupted } from "@opencode/core/session/tool-interrupted"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Redact } from "@opencode/util/redact"
import { ClaudeCodeStore } from "./fixture/claude-code-store"
import { promptLocationNode } from "./fixture/prompt-location"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "redcode-claude-import-")))
const project = path.join(root, "project")
const claude = path.join(root, "claude")
const opencode = path.join(root, "opencode")
mkdirSync(project, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

const SESSION = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const SECRET = "AKIAABCDEFGHIJKLMNOP"
const big = "x".repeat(ClaudeCodeImport.OUTPUT_LIMIT + 1_000)
const cc = ClaudeCodeStore.transcript(SESSION, project)
const meta = (type: string, extra: ClaudeCodeStore.Line = {}) => ({ type, sessionId: SESSION, ...extra })

const records = [
  meta("queue-operation", { operation: "enqueue", timestamp: "2026-01-01T00:00:00.000Z" }),
  meta("file-history-snapshot", { messageId: "u1", snapshot: {}, isSnapshotUpdate: false }),
  cc.user("u1", null, 1, "Fix the   build\nplease"),
  cc.attachment("att1", "u1", 1, { type: "hook_success", hookName: "SessionStart" }),
  cc.assistant("a1", "att1", 2, {
    id: "msg_1",
    block: { type: "thinking", thinking: "Let me look", signature: "sig" },
  }),
  cc.assistant("a2", "a1", 2, { id: "msg_1", block: { type: "text", text: "Looking" } }),
  cc.assistant("a3", "a2", 3, {
    id: "msg_1",
    block: { type: "tool_use", id: "toolu_a", name: "Bash", input: { command: "ls" } },
  }),
  cc.assistant("a4", "a3", 3, {
    id: "msg_1",
    block: { type: "tool_use", id: "toolu_b", name: "Read", input: { file_path: "missing.ts" } },
    stop: "tool_use",
    output: 7,
  }),
  // Parallel tool calls branch the tree: the first result hangs off the first call.
  cc.result("r1", "a3", 4, "toolu_a", `ok ${SECRET}`),
  cc.result("r2", "a4", 4, "toolu_b", [{ type: "text", text: "File does not exist." }], { isError: true }),
  cc.assistant("a5", "r2", 5, {
    id: "msg_2",
    block: { type: "tool_use", id: "toolu_agent", name: "Agent", input: { description: "Explore", prompt: "look" } },
    stop: "tool_use",
  }),
  cc.result("r3", "a5", 9, "toolu_agent", [{ type: "text", text: "Found it" }], {
    toolUseResult: { agentId: "sub1", status: "completed" },
  }),
  cc.assistant("a6", "r3", 10, {
    id: "msg_3",
    block: { type: "tool_use", id: "toolu_big", name: "Bash", input: { command: "cat big" } },
  }),
  cc.result("r4", "a6", 10, "toolu_big", [
    { type: "text", text: big },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
  ]),
  cc.assistant("a7", "r4", 11, { id: "msg_4", block: { type: "text", text: "Before compaction" }, stop: "end_turn" }),
  cc.attachment("q1", "a7", 11.5, {
    type: "queued_command",
    prompt: "Also run the tests",
    commandMode: "prompt",
    origin: { kind: "human" },
  }),
  cc.user("u2", "q1", 12, [
    { type: "text", text: "Look at this" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
  ]),
  cc.assistant("a8", "u2", 13, { id: "msg_5", block: { type: "text", text: "Nice image" }, stop: "end_turn" }),
  cc.system("b1", null, 14, "compact_boundary", {
    logicalParentUuid: "a8",
    compactMetadata: { trigger: "manual", preservedSegment: { headUuid: "u2", tailUuid: "a8", anchorUuid: "s1" } },
  }),
  cc.user("s1", "b1", 14, "Summary of the work", { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
  cc.user("u3", "s1", 15, "Continue"),
  cc.assistant("x1", "u3", 16, { id: "msg_x", block: { type: "text", text: "Abandoned" }, stop: "end_turn" }),
  // The user rewound and prompted again from the summary.
  cc.user("u3b", "s1", 17, "Continue differently"),
  cc.user("m1", "u3b", 17, "<local-command-caveat>hidden</local-command-caveat>", { isMeta: true }),
  cc.assistant("a9", "m1", 18, {
    id: "msg_6",
    block: { type: "tool_use", id: "toolu_dangling", name: "Bash", input: { command: "sleep 100" } },
    stop: "tool_use",
  }),
  meta("last-prompt", { lastPrompt: "Continue differently", leafUuid: "u3b" }),
  meta("custom-title", { customTitle: "Build fix" }),
  meta("mode", { mode: "acceptEdits" }),
  cc.assistant("a10", "a9", 19, { id: "msg_8", block: { type: "text", text: "Done" }, stop: "end_turn" }),
  // A late record on the abandoned branch is not the active leaf: the recorded last prompt is.
  cc.attachment("x2", "x1", 20, { type: "date_change" }),
]

const sub = ClaudeCodeStore.transcript(SESSION, project, { agentId: "sub1" })
const agent = {
  id: "sub1",
  meta: { agentType: "Explore", description: "Explore the repo", toolUseId: "toolu_agent", spawnDepth: 1 },
  records: [
    sub.user("s-u1", null, 6, "look"),
    sub.assistant("s-a1", "s-u1", 7, { id: "msg_s1", block: { type: "text", text: "Found it" }, stop: "end_turn" }),
  ],
}

const other = ClaudeCodeStore.transcript(OTHER, path.join(root, "gone"))
ClaudeCodeStore.write(claude, { cwd: project, session: SESSION, records, agents: [agent] })
ClaudeCodeStore.write(claude, {
  cwd: path.join(root, "gone"),
  session: OTHER,
  records: [other.user("o1", null, 30, "Elsewhere")],
})

const input = (lines: ReadonlyArray<ClaudeCodeStore.Line>) => ({
  sessionId: SESSION,
  main: ClaudeCodeImport.parse(ClaudeCodeStore.jsonl(lines)),
  agents: [
    { id: agent.id, meta: agent.meta, transcript: ClaudeCodeImport.parse(ClaudeCodeStore.jsonl(agent.records)) },
  ],
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
      SessionTransfer.node,
      SessionImport.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
      LocationServiceMap.node.replace(promptLocationNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      SessionImport.node.replace(
        SessionImport.configured({ opencode: [opencode], claudeCode: [claude], pi: [opencode], omp: [opencode] }),
      ),
    ],
  ),
)

describe("ClaudeCodeImport.normalize", () => {
  const result = ClaudeCodeImport.normalize(input(records))
  const [main, child] = result.sessions
  const messages = main!.data.messages

  test("imports the active branch, merging the records of one response into one step", () => {
    expect(messages.map((message) => message.type)).toEqual([
      "user",
      "assistant",
      "assistant",
      "assistant",
      "assistant",
      "user",
      "user",
      "assistant",
      "compaction",
      "user",
      "assistant",
      "assistant",
    ])
    expect(messages[0]).toMatchObject({ type: "user", text: "Fix the   build\nplease" })
    expect(messages[1]).toMatchObject({
      type: "assistant",
      agent: "build",
      model: { id: "claude-test-1", providerID: "anthropic" },
      finish: "tool-calls",
      tokens: { input: 10, output: 7, reasoning: 0, cache: { read: 100, write: 5 } },
      content: [
        { type: "reasoning", text: "Let me look" },
        { type: "text", text: "Looking" },
        { type: "tool", id: "toolu_a", name: "Bash" },
        { type: "tool", id: "toolu_b", name: "Read" },
      ],
    })
    expect(JSON.stringify(messages[1])).not.toContain("sig")
    expect(main!.data.info).toMatchObject({ title: "Build fix", agent: "build", location: { directory: project } })
    expect(main!.version).toBe("2.1.0")
  })

  test("pairs tool results across branches, keeps errors, and redacts secrets", () => {
    const step = messages[1]!
    if (step.type !== "assistant") throw new Error("expected an assistant step")
    expect(step.content[2]).toMatchObject({
      state: {
        status: "completed",
        input: { command: "ls" },
        content: [{ type: "text", text: `ok ${Redact.placeholder("aws-access-key")}` }],
      },
    })
    expect(step.content[3]).toMatchObject({
      state: {
        status: "error",
        error: { type: "tool", message: "File does not exist." },
        content: [{ type: "text", text: "File does not exist." }],
      },
    })
  })

  test("truncates oversized tool output and keeps images as files", () => {
    const step = messages[3]!
    if (step.type !== "assistant" || step.content[0]?.type !== "tool" || step.content[0].state.status !== "completed")
      throw new Error("expected a completed tool")
    const [text, image] = step.content[0].state.content
    expect(text).toEqual({
      type: "text",
      text: `${"x".repeat(ClaudeCodeImport.OUTPUT_LIMIT)}\n\n[Output truncated by the Claude Code import: 1000 more characters]`,
    })
    expect(image).toEqual({ type: "file", uri: "data:image/png;base64,aGVsbG8=", mime: "image/png" })
    expect(messages[6]).toMatchObject({
      type: "user",
      text: "Look at this",
      files: [{ data: "aGVsbG8=", mime: "image/png", source: { type: "inline" } }],
    })
    expect(messages[5]).toMatchObject({ type: "user", text: "Also run the tests" })
  })

  test("maps a compaction boundary and its summary, serializing the preserved tail", () => {
    expect(messages[8]).toMatchObject({
      type: "compaction",
      status: "completed",
      reason: "manual",
      summary: "Summary of the work",
      recent: "[User]: Look at this\n\n[Assistant]: Nice image",
    })
    expect(messages[9]).toMatchObject({ type: "user", text: "Continue differently" })
  })

  test("marks a tool call without a result as interrupted", () => {
    expect(messages[10]).toMatchObject({
      type: "assistant",
      content: [
        {
          type: "tool",
          id: "toolu_dangling",
          state: { status: "error", error: { type: "aborted", message: ToolInterrupted.MESSAGE } },
        },
      ],
    })
    expect(messages[11]).toMatchObject({ type: "assistant", content: [{ type: "text", text: "Done" }] })
  })

  test("imports a subagent transcript as a child session linked from the parent's tool call", () => {
    expect(child).toMatchObject({ ref: `${SESSION}/agent-sub1` })
    expect(child!.data.info).toMatchObject({
      parentID: main!.data.info.id,
      agent: "explore",
      title: "Explore the repo",
    })
    expect(child!.data.messages.map((message) => message.type)).toEqual(["user", "assistant"])
    expect(messages[2]).toMatchObject({
      content: [
        { type: "tool", name: "Agent", state: { status: "completed", metadata: { sessionID: child!.data.info.id } } },
      ],
    })
  })

  test("reports what it could not import", () => {
    expect(main!.warnings).toEqual([
      "Dropped 1 attachment record (hook output, reminders and injected context)",
      "Dropped 1 hidden meta message",
      "Dropped the thinking signatures of 1 reasoning block; the reasoning text is kept",
      "Truncated 1 tool output above 64 KB",
      "Marked 1 tool call without a result as interrupted",
      "File history was not imported (1 snapshot); edits made before the import cannot be reverted",
      "Permission mode changes were not imported",
    ])
    expect(child!.warnings).toEqual([])
  })

  test("derives stable Redcode IDs from the session and its active branch", () => {
    const again = ClaudeCodeImport.normalize(input(records))
    expect(again.sessions.map((item) => item.data.info.id)).toEqual(result.sessions.map((item) => item.data.info.id))
    expect(again.sessions[0]!.data.messages.map((message) => message.id)).toEqual(messages.map((message) => message.id))
    expect(main!.data.info.id).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    expect(messages.every((message) => /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/.test(message.id))).toBe(true)
    expect(messages.map((message) => message.id)).toEqual(messages.map((message) => message.id).toSorted())
    // Without the recorded last prompt the newest record ends the branch, which is a different conversation.
    const unrecorded = ClaudeCodeImport.normalize(input(records.filter((record) => record.type !== "last-prompt")))
    expect(unrecorded.sessions[0]!.data.info.id).not.toBe(main!.data.info.id)
    expect(unrecorded.sessions[0]!.data.messages.at(-1)).toMatchObject({ content: [{ text: "Abandoned" }] })
  })

  test("skips unreadable lines and reports them", () => {
    const parsed = ClaudeCodeImport.parse(`${ClaudeCodeStore.jsonl([cc.user("u1", null, 1, "Hi")])}{not json\n`)
    expect(parsed.invalid).toBe(1)
    const normalized = ClaudeCodeImport.normalize({ sessionId: SESSION, main: parsed, agents: [] })
    expect(normalized.sessions[0]!.warnings).toEqual(["Skipped 1 unreadable line"])
    expect(normalized.sessions[0]!.data.info.title).toBe("Hi")
  })
})

describe("ImportSource.directory", () => {
  test.if(process.platform === "win32")("canonicalizes Windows long-path prefixes, drive case and WSL mounts", () => {
    expect(ImportSource.directory("\\\\?\\c:\\Users\\dev\\project")).toBe("C:\\Users\\dev\\project")
    expect(ImportSource.directory("c:\\Users\\dev")).toBe("C:\\Users\\dev")
    expect(ImportSource.directory("/mnt/c/Users/dev")).toBe("C:\\Users\\dev")
  })

  test.if(process.platform !== "win32")("keeps POSIX directories as recorded", () => {
    expect(ImportSource.directory("/home/dev/project/")).toBe("/home/dev/project")
  })
})

describe("SessionImport with Claude Code", () => {
  it.effect("detects the store and lists sessions recorded in a directory from their headers", () =>
    Effect.gen(function* () {
      const imports = yield* SessionImport.Service
      expect((yield* imports.sources()).find((source) => source.source === "claude-code")).toEqual({
        source: "claude-code",
        name: "Claude Code",
        available: true,
        path: path.join(claude, "projects"),
        sessions: 2,
      })
      expect((yield* imports.list("claude-code")).map((item) => item.ref)).toEqual([OTHER, SESSION])
      const local = yield* imports.list("claude-code", { directory: project })
      expect(local).toEqual([
        {
          source: "claude-code",
          ref: SESSION,
          title: "Build fix",
          directory: project,
          messages: 12,
          subagents: 1,
          model: "anthropic/claude-test-1",
          time: expect.objectContaining({}),
        },
      ])
    }),
  )

  it.effect("imports a session with its subagent and reports a repeated import", () =>
    Effect.gen(function* () {
      const imports = yield* SessionImport.Service
      const sessions = yield* Session.Service
      const transfer = yield* SessionTransfer.Service
      const result = yield* imports.import("claude-code", SESSION)
      expect(result.sessions).toHaveLength(2)
      expect(result.session.metadata?.import).toMatchObject({
        source: "claude-code",
        sourceID: SESSION,
        sourceVersion: "2.1.0",
      })
      expect((yield* sessions.get(result.sessions[1]!)).parentID).toBe(result.session.id)
      const exported = yield* transfer.export({ sessionID: result.session.id })
      expect(exported.messages).toHaveLength(13)
      expect(exported.messages.at(-1)).toMatchObject({
        type: "system",
        description: "Imported from Claude Code · 12 messages · 1 subagent · 1 compaction",
        text: expect.stringContaining("Bash and PowerShell → shell"),
      })
      const again = yield* imports.import("claude-code", SESSION).pipe(Effect.flip)
      expect(again).toEqual(new SessionImport.AlreadyImportedError({ sessionID: result.session.id }))
      const missing = yield* imports.import("claude-code", "../escape").pipe(Effect.flip)
      expect(missing).toEqual(new SessionImport.NotFoundError({ source: "claude-code", ref: "../escape" }))
    }),
  )

  test("orders listed sessions by their recorded time when file modification times tie", async () => {
    const store = path.join(root, "tied")
    const older = ClaudeCodeStore.transcript(SESSION, project)
    const newer = ClaudeCodeStore.transcript(OTHER, project)
    ClaudeCodeStore.write(store, { cwd: project, session: SESSION, records: [older.user("t1", null, 40, "Older")] })
    ClaudeCodeStore.write(store, { cwd: project, session: OTHER, records: [newer.user("t2", null, 50, "Newer")] })
    const files = path.join(store, "projects", project.replace(/[^A-Za-z0-9]/g, "-"))
    const tick = new Date(Date.UTC(2026, 0, 2))
    ;[SESSION, OTHER].forEach((session) => utimesSync(path.join(files, `${session}.jsonl`), tick, tick))
    const listed = await Effect.runPromise(ClaudeCodeImport.adapter({ directories: [store] }).list({ limit: 10 }))
    expect(listed.map((item) => [item.ref, item.title])).toEqual([
      [OTHER, "Newer"],
      [SESSION, "Older"],
    ])
  })

  test("reports a missing store", async () => {
    const detected = await Effect.runPromise(
      ClaudeCodeImport.adapter({ directories: [path.join(root, "none")] }).detect(),
    )
    expect(detected).toEqual({
      source: "claude-code",
      name: "Claude Code",
      available: false,
      sessions: 0,
      warning: "No Claude Code session store found",
    })
  })
})
