import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
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
import { PiImport } from "@opencode/core/session/import/pi"
import { SessionImport } from "@opencode/core/session/import/service"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTransfer } from "@opencode/core/session/transfer"
import { ToolInterrupted } from "@opencode/core/session/tool-interrupted"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Redact } from "@opencode/util/redact"
import { PiStore } from "./fixture/pi-store"
import { promptLocationNode } from "./fixture/prompt-location"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "redcode-pi-import-")))
const project = path.join(root, "project")
const piStore = path.join(root, "pi", "agent", "sessions")
const ompStore = path.join(root, "omp", "agent", "sessions")
const empty = path.join(root, "empty")
mkdirSync(project, { recursive: true })
mkdirSync(empty, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

const OMP_SESSION = "019c625b-b900-7000-8000-000000000001"
const PI_SESSION = "019c625b-b900-7000-8000-000000000002"
const OTHER = "019c625b-b900-7000-8000-000000000003"
const SECRET = "AKIAABCDEFGHIJKLMNOP"
const IMAGE = new TextEncoder().encode("hello")
const HASH = createHash("sha256").update(IMAGE).digest("hex")
const big = "x".repeat(PiImport.OUTPUT_LIMIT + 1_000)
const call = (id: string, name: string, args: Record<string, unknown>) => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
})

const records = [
  PiStore.titleSlot("Build fix"),
  PiStore.header(OMP_SESSION, project, 0),
  PiStore.entry("model_change", "mc1", null, 0, { model: "anthropic/claude-test-1" }),
  PiStore.raw("sys1", "mc1", 0, { role: "developer", content: "Be careful" }),
  PiStore.user("u1", "sys1", 1, "Fix the   build\nplease"),
  PiStore.assistant(
    "a1",
    "u1",
    2,
    [
      { type: "thinking", thinking: "Let me look", thinkingSignature: "sig" },
      { type: "redactedThinking", data: "opaque" },
      { type: "text", text: "Looking" },
      call("call_a", "bash", { command: "ls" }),
      call("call_b", "read", { path: "missing.ts" }),
    ],
    { stopReason: "toolUse", usage: PiStore.usage(7) },
  ),
  PiStore.result("r1", "a1", 3, { id: "call_a", name: "bash" }, [{ type: "text", text: `ok ${SECRET}` }]),
  PiStore.result("r2", "r1", 3, { id: "call_b", name: "read" }, [{ type: "text", text: "File does not exist." }], {
    isError: true,
  }),
  PiStore.assistant("a2", "r2", 4, [call("call_task", "task", { agent: "explore", task: "look" })], {
    stopReason: "toolUse",
  }),
  PiStore.result("r3", "a2", 8, { id: "call_task", name: "task" }, [{ type: "text", text: "Found it" }], {
    details: {
      projectAgentsDir: null,
      results: [{ id: "Scout", agent: "explore", description: "Explore the repo" }],
      totalDurationMs: 1,
    },
  }),
  PiStore.assistant("a3", "r3", 9, [call("call_big", "bash", { command: "cat big" })], { stopReason: "toolUse" }),
  PiStore.result("r4", "a3", 10, { id: "call_big", name: "bash" }, [
    { type: "text", text: big },
    { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
  ]),
  PiStore.assistant("a4", "r4", 11, [{ type: "text", text: "Before compaction" }]),
  PiStore.user("u2", "a4", 12, [
    { type: "text", text: "Look at this" },
    { type: "image", data: `blob:sha256:${HASH}`, mimeType: "image/png" },
  ]),
  PiStore.raw("bx", "u2", 12.5, { role: "bashExecution", command: "git status", output: "clean", exitCode: 0 }),
  PiStore.assistant("a5", "bx", 13, [{ type: "text", text: "Nice image" }]),
  PiStore.entry("compaction", "c1", "a5", 14, {
    summary: "Summary of the work",
    firstKeptEntryId: "u2",
    tokensBefore: 9,
  }),
  PiStore.user("u3", "c1", 15, "Continue"),
  PiStore.assistant("x1", "u3", 16, [{ type: "text", text: "Abandoned" }]),
  // The user went back to the compaction with /tree, leaving a summary of the abandoned branch.
  PiStore.entry("branch_summary", "bs1", "c1", 17, { fromId: "x1", summary: "Tried continuing" }),
  PiStore.user("u3b", "bs1", 17, "Continue differently"),
  PiStore.user("syn", "u3b", 17.5, "continue", { synthetic: true }),
  PiStore.entry("custom_message", "cm1", "syn", 17.6, { customType: "ext", content: "Injected", display: true }),
  PiStore.assistant("a6", "cm1", 18, [call("call_dangling", "bash", { command: "sleep 100" })], {
    stopReason: "toolUse",
  }),
  PiStore.entry("custom", "cu1", "a6", 18.5, { customType: "tool_execution_start", data: {} }),
  PiStore.entry("mode_change", "mo1", "cu1", 18.6, { mode: "plan" }),
  PiStore.assistant("a7", "mo1", 19, [{ type: "text", text: "Done" }]),
]

const scout = [
  PiStore.header("019c625b-b900-7000-8000-00000000000a", project, 5, { parentSession: OMP_SESSION }),
  PiStore.entry("session_init", "si", null, 5, { systemPrompt: [], task: "look", tools: [], agent: "explore" }),
  PiStore.user("s-u1", "si", 6, "look"),
  PiStore.assistant("s-a1", "s-u1", 7, [{ type: "text", text: "Found it" }]),
]
const deep = [
  PiStore.header("019c625b-b900-7000-8000-00000000000b", project, 6),
  PiStore.user("d-u1", null, 6, "dig deeper"),
  PiStore.assistant("d-a1", "d-u1", 7, [{ type: "text", text: "Dug" }]),
]

const piRecords = [
  PiStore.header(PI_SESSION, project, 0),
  PiStore.user("p1", null, 1, "Hello Pi"),
  PiStore.assistant(
    "p2",
    "p1",
    2,
    [
      { type: "thinking", thinking: "", thinkingSignature: "encrypted", redacted: true },
      { type: "text", text: "Hi" },
    ],
    { provider: "openai", model: "gpt-test" },
  ),
  PiStore.entry("model_change", "p3", "p2", 3, { provider: "anthropic", modelId: "claude-test-1" }),
  PiStore.entry("session_info", "p4", "p3", 3, { name: "Pi work" }),
  PiStore.entry("label", "p5", "p4", 3, { targetId: "p1", label: "start" }),
]

PiStore.write(ompStore, {
  bucket: PiStore.bucket(project),
  file: `2026-01-01T00-00-00-000Z_${OMP_SESSION}`,
  records,
  agents: [
    { id: "Scout", records: scout },
    { id: "Scout.Deep", records: deep },
  ],
  blobs: [{ hash: HASH, bytes: IMAGE }],
})
PiStore.write(piStore, {
  bucket: PiStore.bucket(project),
  file: `2026-01-01T00-00-00-000Z_${PI_SESSION}`,
  records: piRecords,
})
PiStore.write(piStore, {
  bucket: PiStore.bucket(path.join(root, "gone")),
  file: `2026-01-02T00-00-00-000Z_${OTHER}`,
  records: [PiStore.header(OTHER, path.join(root, "gone"), 30), PiStore.user("o1", null, 30, "Elsewhere")],
})

const transcript = (lines: ReadonlyArray<PiStore.Line>) => PiImport.parse(PiStore.jsonl(lines))
const ompInput = (lines: ReadonlyArray<PiStore.Line>) => ({
  source: "omp" as const,
  sessionId: OMP_SESSION,
  main: transcript(lines),
  agents: [
    { id: "Scout", transcript: transcript(scout) },
    { id: "Scout.Deep", transcript: transcript(deep) },
  ],
  blobs: new Map([[HASH, "aGVsbG8="]]),
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
        SessionImport.configured({ opencode: [empty], claudeCode: [empty], pi: [piStore], omp: [ompStore] }),
      ),
    ],
  ),
)

describe("PiImport.normalize", () => {
  const result = PiImport.normalize(ompInput(records))
  const [main, scoutSession, deepSession] = result.sessions
  const messages = main!.data.messages

  test("imports the branch ending at the last entry", () => {
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
      "system",
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
      cost: 0.03,
      tokens: { input: 10, output: 7, reasoning: 0, cache: { read: 100, write: 5 } },
      content: [
        { type: "reasoning", text: "Let me look" },
        { type: "text", text: "Looking" },
        { type: "tool", id: "call_a", name: "bash" },
        { type: "tool", id: "call_b", name: "read" },
      ],
    })
    expect(JSON.stringify(messages[1])).not.toContain("sig")
    expect(main!.data.info).toMatchObject({
      title: "Build fix",
      agent: "build",
      model: { id: "claude-test-1", providerID: "anthropic" },
      location: { directory: project },
    })
    expect(main!.data.info.cost).toBeCloseTo(0.21)
  })

  test("pairs tool results, keeps errors, and redacts secrets", () => {
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

  test("truncates oversized tool output, keeps images, and resolves blob references", () => {
    const step = messages[3]!
    if (step.type !== "assistant" || step.content[0]?.type !== "tool" || step.content[0].state.status !== "completed")
      throw new Error("expected a completed tool")
    const [text, image] = step.content[0].state.content
    expect(text).toEqual({
      type: "text",
      text: `${"x".repeat(PiImport.OUTPUT_LIMIT)}\n\n[Output truncated by the oh-my-pi import: 1000 more characters]`,
    })
    expect(image).toEqual({ type: "file", uri: "data:image/png;base64,aGVsbG8=", mime: "image/png" })
    expect(messages[5]).toMatchObject({
      type: "user",
      text: "Look at this",
      files: [{ data: "aGVsbG8=", mime: "image/png", source: { type: "inline" } }],
    })
    expect(messages[6]).toMatchObject({ type: "user", text: "I ran `git status` (exit code 0):\n\nclean" })
  })

  test("maps a compaction with its kept entries and a branch summary", () => {
    expect(messages[8]).toMatchObject({
      type: "compaction",
      status: "completed",
      reason: "auto",
      summary: "Summary of the work",
      recent: "[User]: Look at this\n\n[Assistant]: Nice image",
    })
    expect(messages[9]).toMatchObject({
      type: "system",
      text: expect.stringContaining("Tried continuing"),
      description: "Summary of an abandoned branch",
    })
    expect(messages[10]).toMatchObject({ type: "user", text: "Continue differently" })
  })

  test("marks a tool call without a result as interrupted", () => {
    expect(messages[11]).toMatchObject({
      type: "assistant",
      content: [
        {
          type: "tool",
          id: "call_dangling",
          state: { status: "error", error: { type: "aborted", message: ToolInterrupted.MESSAGE } },
        },
      ],
    })
    expect(messages[12]).toMatchObject({ type: "assistant", content: [{ type: "text", text: "Done" }], finish: "stop" })
  })

  test("imports subagent transcripts as child sessions linked from the task call", () => {
    expect(scoutSession).toMatchObject({ ref: `${OMP_SESSION}/Scout` })
    expect(scoutSession!.data.info).toMatchObject({
      parentID: main!.data.info.id,
      agent: "explore",
      title: "Explore the repo",
    })
    expect(deepSession).toMatchObject({ ref: `${OMP_SESSION}/Scout.Deep` })
    expect(deepSession!.data.info).toMatchObject({
      parentID: scoutSession!.data.info.id,
      agent: "general",
      title: "dig deeper",
    })
    expect(messages[2]).toMatchObject({
      content: [
        {
          type: "tool",
          name: "task",
          state: { status: "completed", metadata: { sessionID: scoutSession!.data.info.id } },
        },
      ],
    })
  })

  test("reports what it could not import", () => {
    expect(main!.warnings).toEqual([
      "Dropped 1 system or developer message (prompt and tool declarations)",
      "Dropped 1 automatic continuation prompt",
      "Dropped 1 extension message",
      "Dropped the thinking signatures of 1 reasoning block; the reasoning text is kept",
      "Skipped 1 redacted reasoning block",
      "Truncated 1 tool output above 64 KB",
      "Marked 1 tool call without a result as interrupted",
      "Extension state was not imported (1 record)",
      "Mode changes such as plan mode were not imported",
    ])
    expect(scoutSession!.warnings).toEqual([])
  })

  test("derives stable Redcode IDs from the session and its leaf", () => {
    const again = PiImport.normalize(ompInput(records))
    expect(again.sessions.map((item) => item.data.info.id)).toEqual(result.sessions.map((item) => item.data.info.id))
    expect(again.sessions[0]!.data.messages.map((message) => message.id)).toEqual(messages.map((message) => message.id))
    expect(main!.data.info.id).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    expect(messages.map((message) => message.id)).toEqual(messages.map((message) => message.id).toSorted())
    // Appending to the abandoned branch makes it the active one, which is a different conversation.
    const resumed = PiImport.normalize(
      ompInput([...records, PiStore.assistant("x2", "x1", 20, [{ type: "text", text: "Back again" }])]),
    )
    expect(resumed.sessions[0]!.data.info.id).not.toBe(main!.data.info.id)
    expect(resumed.sessions[0]!.data.messages.map((message) => message.type)).toEqual([
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
  })

  test("starts after the last /clear and skips unreadable lines", () => {
    const lines = [
      PiStore.header(OMP_SESSION, project, 0),
      PiStore.user("c-u1", null, 1, "Old work"),
      PiStore.assistant("c-a1", "c-u1", 2, [{ type: "text", text: "Old reply" }]),
      PiStore.entry("reset_boundary", "c-r", "c-a1", 3),
      PiStore.user("c-u2", "c-r", 4, "New work"),
      PiStore.assistant("c-a2", "c-u2", 5, [{ type: "text", text: "New reply" }]),
    ]
    const normalized = PiImport.normalize({
      source: "omp",
      sessionId: OMP_SESSION,
      main: PiImport.parse(`${PiStore.jsonl(lines)}{not json\n`),
      agents: [],
    })
    expect(normalized.sessions[0]!.data.messages.map((message) => message.type)).toEqual(["user", "assistant"])
    expect(normalized.sessions[0]!.data.info.title).toBe("New work")
    expect(normalized.sessions[0]!.warnings).toEqual([
      "Skipped 1 unreadable line",
      "Left out 2 messages from before the last /clear",
    ])
  })

  test("reads Pi's session names, redacted thinking, and failed responses", () => {
    const normalized = PiImport.normalize({
      source: "pi",
      sessionId: PI_SESSION,
      main: transcript([
        ...piRecords,
        PiStore.user("p6", "p5", 4, "Again"),
        PiStore.assistant("p7", "p6", 5, [], { stopReason: "error", errorMessage: "Overloaded" }),
      ]),
      agents: [],
    })
    const session = normalized.sessions[0]!
    expect(session.data.info).toMatchObject({
      title: "Pi work",
      model: { id: "claude-test-1", providerID: "anthropic" },
    })
    expect(session.data.messages[1]).toMatchObject({
      type: "assistant",
      model: { id: "gpt-test", providerID: "openai" },
      content: [{ type: "text", text: "Hi" }],
    })
    expect(session.data.messages[3]).toMatchObject({
      type: "assistant",
      finish: "error",
      error: { type: "provider", message: "Overloaded" },
    })
    expect(session.warnings).toEqual(["Skipped 1 redacted reasoning block"])
  })

  test("reads version 1 files, whose entries form one chain without IDs", () => {
    const normalized = PiImport.normalize({
      source: "pi",
      sessionId: PI_SESSION,
      main: transcript([
        { type: "session", id: PI_SESSION, timestamp: "2026-01-01T00:00:00.000Z", cwd: project },
        { type: "message", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "Old format" } },
        {
          type: "message",
          timestamp: "2026-01-01T00:00:02.000Z",
          message: { role: "assistant", content: [{ type: "text", text: "Still works" }], provider: "p", model: "m" },
        },
      ]),
      agents: [],
    })
    expect(normalized.sessions[0]!.data.messages).toMatchObject([
      { type: "user", text: "Old format" },
      { type: "assistant", content: [{ type: "text", text: "Still works" }], model: { id: "m", providerID: "p" } },
    ])
  })
})

describe("SessionImport with Pi and oh-my-pi", () => {
  it.effect("detects both stores and lists sessions recorded in a directory", () =>
    Effect.gen(function* () {
      const imports = yield* SessionImport.Service
      const sources = yield* imports.sources()
      expect(sources.filter((source) => source.source === "pi" || source.source === "omp")).toEqual([
        { source: "pi", name: "Pi", available: true, path: piStore, sessions: 2 },
        // The subagent transcripts in the session's artifacts directory are not sessions of their own.
        { source: "omp", name: "oh-my-pi", available: true, path: ompStore, sessions: 1 },
      ])
      expect((yield* imports.list("pi")).map((item) => item.ref)).toEqual([OTHER, PI_SESSION])
      expect(yield* imports.list("pi", { directory: project })).toEqual([
        {
          source: "pi",
          ref: PI_SESSION,
          title: "Pi work",
          directory: project,
          messages: 2,
          subagents: 0,
          model: "openai/gpt-test",
          time: expect.objectContaining({}),
        },
      ])
      expect(yield* imports.list("omp", { directory: project })).toEqual([
        {
          source: "omp",
          ref: OMP_SESSION,
          title: "Build fix",
          directory: project,
          messages: 12,
          subagents: 2,
          model: "anthropic/claude-test-1",
          time: expect.objectContaining({}),
        },
      ])
    }),
  )

  it.effect("imports a session with its subagents and reports a repeated import", () =>
    Effect.gen(function* () {
      const imports = yield* SessionImport.Service
      const sessions = yield* Session.Service
      const transfer = yield* SessionTransfer.Service
      const result = yield* imports.import("omp", OMP_SESSION)
      expect(result.sessions).toHaveLength(3)
      expect(result.session.metadata?.import).toMatchObject({ source: "omp", sourceID: OMP_SESSION })
      expect((yield* sessions.get(result.sessions[1]!)).parentID).toBe(result.session.id)
      expect((yield* sessions.get(result.sessions[2]!)).parentID).toBe(result.sessions[1])
      const exported = yield* transfer.export({ sessionID: result.session.id })
      expect(exported.messages).toHaveLength(14)
      expect(exported.messages[5]).toMatchObject({ type: "user", files: [{ data: "aGVsbG8=" }] })
      expect(exported.messages.at(-1)).toMatchObject({
        type: "system",
        description: "Imported from oh-my-pi · 13 messages · 2 subagents · 1 compaction",
        text: expect.stringContaining("task → subagent"),
      })
      const again = yield* imports.import("omp", OMP_SESSION).pipe(Effect.flip)
      expect(again).toEqual(new SessionImport.AlreadyImportedError({ sessionID: result.session.id }))
      const missing = yield* imports.import("pi", "../escape").pipe(Effect.flip)
      expect(missing).toEqual(new SessionImport.NotFoundError({ source: "pi", ref: "../escape" }))
    }),
  )

  test("reports a missing store", async () => {
    const detected = await Effect.runPromise(
      PiImport.adapter({ source: "pi", directories: [path.join(root, "none")] }).detect(),
    )
    expect(detected).toEqual({
      source: "pi",
      name: "Pi",
      available: false,
      sessions: 0,
      warning: "No Pi session store found",
    })
  })
})
