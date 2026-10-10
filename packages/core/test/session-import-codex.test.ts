import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
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
import { CodexImport } from "@opencode/core/session/import/codex"
import { SessionImport } from "@opencode/core/session/import/service"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTransfer } from "@opencode/core/session/transfer"
import { ToolInterrupted } from "@opencode/core/session/tool-interrupted"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Redact } from "@opencode/util/redact"
import { CodexStore } from "./fixture/codex-store"
import { promptLocationNode } from "./fixture/prompt-location"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "redcode-codex-import-")))
const project = path.join(root, "project")
const codex = path.join(root, "codex")
const empty = path.join(root, "empty")
mkdirSync(project, { recursive: true })
mkdirSync(empty, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

const THREAD = "019a0000-0000-7000-8000-000000000001"
const CHILD = "019a0000-0000-7000-8000-000000000002"
const IDLE = "019a0000-0000-7000-8000-000000000003"
const OTHER = "019a0000-0000-7000-8000-000000000004"
const EMPTY = "019a0000-0000-7000-8000-000000000005"
const SECRET = "AKIAABCDEFGHIJKLMNOP"
const big = "x".repeat(CodexImport.OUTPUT_LIMIT + 1_000)
const c = CodexStore

const records = [
  c.meta(THREAD, project, 0),
  c.context(0, "gpt-test-1"),
  c.developer(0, "<permissions>sandboxed</permissions>"),
  c.user(0, "<environment_context>\n  <cwd>/</cwd>\n</environment_context>"),
  c.user(1, "Fix the   build\nplease"),
  c.reasoning(2, ["Let me look"]),
  c.assistant(2, "Looking"),
  c.call(3, "call_a", "exec_command", { cmd: "ls" }),
  c.custom(3, "call_b", "apply_patch", "*** Begin Patch"),
  c.output(4, "call_a", `ok ${SECRET}`),
  c.output(
    4,
    "call_b",
    [{ type: "input_text", text: big }, c.image(), { type: "input_image", image_url: "https://example.com/x.png" }],
    "custom_tool_call_output",
  ),
  c.usage(4),
  // A later token count repeats the same response's usage and is ignored.
  c.tokenCount(4),
  c.reasoning(5, []),
  c.call(5, "call_spawn", "spawn_agent", { task_name: "explorer", message: "look" }, "collaboration"),
  c.output(9, "call_spawn", JSON.stringify({ task_name: "/root/explorer" })),
  c.usage(9, 50, 20),
  c.agentMessage(9, "/root/explorer", "Found it"),
  c.user(10, [{ type: "input_text", text: "Look at this" }, c.image()], ["user.text", "user.image"]),
  c.assistant(11, "Nice image"),
  c.usage(11),
  c.compacted(12, "", [c.user(1, "Fix the build"), c.user(1, "<environment_context>x</environment_context>")]),
  c.user(13, "Continue"),
  c.call(14, "call_d", "shell", { command: ["sleep", "100"] }),
  c.item(14, { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "docs" } }),
  c.item(14, { type: "ghost_snapshot", ghost_commit: { id: "abc" } }),
  c.item(14, { type: "mystery_item" }),
  c.event(14, "task_complete"),
  c.assistant(15, "Done"),
  c.usage(15),
]

const child = [
  c.meta(CHILD, project, 6, {
    session_id: THREAD,
    forked_from_id: THREAD,
    parent_thread_id: THREAD,
    thread_source: "subagent",
    subagent_history_start_ordinal: 3,
    source: { subagent: { thread_spawn: { parent_thread_id: THREAD, depth: 1, agent_path: "/root/explorer" } } },
  }),
  c.meta(THREAD, project, 0),
  // Inherited from the parent conversation; not imported again.
  c.user(1, "Fix the build"),
  c.user(6, "look"),
  c.assistant(7, "Found it"),
  c.usage(7),
]

// A subagent that never ran past its inherited context.
const idle = [
  c.meta(IDLE, project, 8, { parent_thread_id: THREAD, thread_source: "subagent", subagent_history_start_ordinal: 2 }),
  c.user(1, "Fix the build"),
]

c.index(codex, [{ id: THREAD, name: "Build fix" }])
c.write(codex, { thread: THREAD, records, mtime: 100 })
c.write(codex, { thread: CHILD, records: child, mtime: 100 })
c.write(codex, { thread: IDLE, records: idle, mtime: 100 })
// A thread opened and left before its first prompt is not listed.
c.write(codex, { thread: EMPTY, records: [c.meta(EMPTY, project, 40)], mtime: 300 })
c.write(codex, {
  thread: OTHER,
  archived: true,
  records: [c.meta(OTHER, path.join(root, "gone"), 30), c.user(30, "Elsewhere")],
  mtime: 200,
})

const transcript = (lines: ReadonlyArray<CodexStore.Line>, from = 0) => CodexImport.parse(CodexStore.jsonl(lines, from))
const input = (lines: ReadonlyArray<CodexStore.Line>) => ({
  thread: { id: THREAD, pages: [transcript(lines)] },
  subagents: [
    { id: CHILD, pages: [transcript(child)] },
    { id: IDLE, pages: [transcript(idle)] },
  ],
  title: "Build fix",
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
        SessionImport.configured({ opencode: [empty], claudeCode: [empty], pi: [empty], omp: [empty], codex: [codex] }),
      ),
    ],
  ),
)

describe("CodexImport.normalize", () => {
  const result = CodexImport.normalize(input(records))
  const [main, sub] = result.sessions
  const messages = main!.data.messages

  test("imports prompts, merges the items of one response into one step and drops injected context", () => {
    expect(messages.map((message) => message.type)).toEqual([
      "user",
      "assistant",
      "assistant",
      "synthetic",
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
      model: { id: "gpt-test-1", providerID: "openai" },
      finish: "tool-calls",
      tokens: { input: 60, output: 20, reasoning: 10, cache: { read: 40, write: 0 } },
      content: [
        { type: "reasoning", text: "Let me look" },
        { type: "text", text: "Looking" },
        { type: "tool", id: "call_a", name: "exec_command", state: { input: { cmd: "ls" } } },
        { type: "tool", id: "call_b", name: "apply_patch", state: { input: { input: "*** Begin Patch" } } },
      ],
    })
    expect(JSON.stringify(messages)).not.toContain("gAAAA")
    expect(main!.data.info).toMatchObject({
      title: "Build fix",
      agent: "build",
      model: { id: "gpt-test-1", providerID: "openai" },
      location: { directory: project },
      tokens: { input: 190, output: 70, reasoning: 40, cache: { read: 160, write: 0 } },
    })
    expect(main!.version).toBe("0.200.0")
  })

  test("pairs tool results, redacts secrets, truncates oversized output and keeps inline images", () => {
    const step = messages[1]!
    if (step.type !== "assistant") throw new Error("expected an assistant step")
    expect(step.content[2]).toMatchObject({
      state: { status: "completed", content: [{ type: "text", text: `ok ${Redact.placeholder("aws-access-key")}` }] },
    })
    const patch = step.content[3]
    if (patch?.type !== "tool" || patch.state.status !== "completed") throw new Error("expected a completed tool")
    expect(patch.state.content).toEqual([
      {
        type: "text",
        text: `${"x".repeat(CodexImport.OUTPUT_LIMIT)}\n\n[Output truncated by the Codex import: 1000 more characters]`,
      },
      { type: "file", uri: "data:image/png;base64,aGVsbG8=", mime: "image/png" },
    ])
    expect(messages[4]).toMatchObject({
      type: "user",
      text: "Look at this",
      files: [{ data: "aGVsbG8=", mime: "image/png", source: { type: "inline" } }],
    })
  })

  test("links the spawning tool call to the subagent session and imports agent messages", () => {
    expect(sub).toMatchObject({ ref: CHILD })
    expect(sub!.data.info).toMatchObject({ parentID: main!.data.info.id, agent: "general", title: "explorer" })
    expect(sub!.data.messages.map((message) => message.type)).toEqual(["user", "assistant"])
    expect(sub!.data.messages[0]).toMatchObject({ text: "look" })
    expect(messages[2]).toMatchObject({
      tokens: { input: 10, output: 10 },
      content: [
        {
          type: "tool",
          name: "collaboration__spawn_agent",
          state: { status: "completed", metadata: { sessionID: sub!.data.info.id } },
        },
      ],
    })
    expect(messages[3]).toMatchObject({
      type: "synthetic",
      text: "Found it",
      description: "Message from /root/explorer",
    })
    expect(result.sessions).toHaveLength(2)
  })

  test("maps an encrypted compaction to a compaction carrying the user messages Codex kept", () => {
    expect(messages[6]).toMatchObject({
      type: "compaction",
      status: "completed",
      reason: "auto",
      summary: expect.stringContaining("encrypted summary"),
      recent: "[User]: Fix the build",
    })
    expect(messages[7]).toMatchObject({ type: "user", text: "Continue" })
  })

  test("marks a tool call without a result as interrupted and keeps provider web searches", () => {
    expect(messages[8]).toMatchObject({
      type: "assistant",
      content: [
        {
          type: "tool",
          id: "call_d",
          state: { status: "error", error: { type: "aborted", message: ToolInterrupted.MESSAGE } },
        },
        { type: "tool", name: "web_search", state: { status: "completed", input: { type: "search", query: "docs" } } },
      ],
    })
    expect(messages[8]).not.toHaveProperty("finish")
    expect(messages[9]).toMatchObject({ type: "assistant", finish: "stop", content: [{ type: "text", text: "Done" }] })
  })

  test("reports what it could not import", () => {
    expect(main!.warnings).toEqual([
      "Dropped 1 injected context message (environment context, AGENTS.md and app context)",
      "Dropped 1 developer message (permission, sandbox and collaboration instructions)",
      "Dropped the encrypted content of 2 reasoning items; 1 readable summary is kept",
      "Codex encrypted 1 compaction summary; each compaction keeps only the user messages Codex retained",
      "Dropped the encrypted content of 1 message from other agents",
      "Skipped 1 image that was not inline",
      "Truncated 1 tool output above 64 KB",
      "Marked 1 tool call without a result as interrupted",
      "Skipped unsupported content: mystery_item item",
      "File snapshots were not imported (1 snapshot); edits made before the import cannot be reverted",
      "Skipped 1 subagent session without messages",
    ])
    expect(sub!.warnings).toEqual([])
  })

  test("derives stable Redcode IDs from the thread and the end of its history", () => {
    const again = CodexImport.normalize(input(records))
    expect(again.sessions.map((item) => item.data.info.id)).toEqual(result.sessions.map((item) => item.data.info.id))
    expect(again.sessions[0]!.data.messages.map((message) => message.id)).toEqual(messages.map((message) => message.id))
    expect(main!.data.info.id).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    expect(messages.every((message) => /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/.test(message.id))).toBe(true)
    expect(messages.map((message) => message.id)).toEqual(messages.map((message) => message.id).toSorted())
    // A thread that continued since is a different snapshot.
    const continued = CodexImport.normalize(input([...records, c.user(16, "More")]))
    expect(continued.sessions[0]!.data.info.id).not.toBe(main!.data.info.id)
  })

  test("follows a continuation page, which replaces the history after its base", () => {
    const base = [
      c.meta(THREAD, project, 0),
      c.user(1, "First"),
      c.assistant(2, "A1"),
      c.usage(2),
      c.user(3, "Abandoned"),
      c.assistant(4, "Gone"),
    ]
    const page = [c.meta(THREAD, project, 5, { history_base: { thread_id: THREAD, end_ordinal_exclusive: 4 } })]
    const normalized = CodexImport.normalize({
      thread: {
        id: THREAD,
        pages: [transcript(base), transcript([...page, c.user(5, "Second"), c.assistant(6, "A2")], 4)],
      },
      subagents: [],
    })
    expect(
      normalized.sessions[0]!.data.messages.map((message) =>
        message.type === "user" ? message.text : message.type === "assistant" ? message.content[0] : message.type,
      ),
    ).toEqual(["First", { type: "text", text: "A1" }, "Second", { type: "text", text: "A2" }])
    expect(normalized.sessions[0]!.data.info.title).toBe("First")
  })

  test("reads rollouts written before records had envelopes", () => {
    const legacy = CodexImport.parse(
      [
        { id: THREAD, timestamp: CodexStore.iso(0), instructions: null, git: null },
        { record_type: "state" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions for /" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Hi" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello" }] },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n") + "\n{not json\n",
    )
    expect(legacy.invalid).toBe(1)
    const normalized = CodexImport.normalize({ thread: { id: THREAD, pages: [legacy] }, subagents: [] })
    expect(normalized.sessions[0]!.data.messages).toMatchObject([
      { type: "user", text: "Hi" },
      { type: "assistant", content: [{ type: "text", text: "Hello" }] },
    ])
    expect(normalized.sessions[0]!.warnings).toEqual([
      "Skipped 1 unreadable line",
      "Dropped 1 injected context message (environment context, AGENTS.md and app context)",
    ])
  })
})

describe("SessionImport with Codex", () => {
  it.effect("detects the store and lists top-level threads from their heads and tails", () =>
    Effect.gen(function* () {
      const imports = yield* SessionImport.Service
      expect((yield* imports.sources()).find((source) => source.source === "codex")).toEqual({
        source: "codex",
        name: "Codex",
        available: true,
        path: codex,
        sessions: 3,
      })
      expect((yield* imports.list("codex")).map((item) => item.ref)).toEqual([OTHER, THREAD])
      expect(yield* imports.list("codex", { directory: project })).toEqual([
        {
          source: "codex",
          ref: THREAD,
          title: "Build fix",
          directory: project,
          messages: 10,
          subagents: 2,
          model: "openai/gpt-test-1",
          time: expect.objectContaining({}),
        },
      ])
    }),
  )

  it.effect("imports a thread with its subagent and reports a repeated import", () =>
    Effect.gen(function* () {
      const imports = yield* SessionImport.Service
      const sessions = yield* Session.Service
      const transfer = yield* SessionTransfer.Service
      const result = yield* imports.import("codex", THREAD)
      expect(result.sessions).toHaveLength(2)
      expect(result.session.metadata?.import).toMatchObject({
        source: "codex",
        sourceID: THREAD,
        sourceVersion: "0.200.0",
      })
      expect((yield* sessions.get(result.sessions[1]!)).parentID).toBe(result.session.id)
      const exported = yield* transfer.export({ sessionID: result.session.id })
      expect(exported.messages).toHaveLength(11)
      expect(exported.messages.at(-1)).toMatchObject({
        type: "system",
        description: "Imported from Codex · 10 messages · 1 subagent · 1 compaction",
        text: expect.stringContaining("apply_patch → patch"),
      })
      const again = yield* imports.import("codex", THREAD).pipe(Effect.flip)
      expect(again).toEqual(new SessionImport.AlreadyImportedError({ sessionID: result.session.id }))
      const missing = yield* imports.import("codex", "../escape").pipe(Effect.flip)
      expect(missing).toEqual(new SessionImport.NotFoundError({ source: "codex", ref: "../escape" }))
    }),
  )

  test("reports a missing store", async () => {
    expect(await Effect.runPromise(CodexImport.adapter({ directories: [empty] }).detect())).toEqual({
      source: "codex",
      name: "Codex",
      available: false,
      sessions: 0,
      warning: "No Codex session store found",
    })
  })
})
