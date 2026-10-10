import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { OpenCodeImport } from "@opencode/core/session/import/opencode"
import { SessionImport } from "@opencode/core/session/import/service"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTransfer } from "@opencode/core/session/transfer"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { OpenCodeStore } from "./fixture/opencode-store"
import { promptLocationNode } from "./fixture/prompt-location"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "redcode-session-import-")))
const project = path.join(root, "project")
const elsewhere = path.join(root, "missing-project")
const store = path.join(root, "opencode")
const legacy = path.join(root, "legacy", "opencode")
const empty = path.join(root, "empty", "opencode")
mkdirSync(project, { recursive: true })
mkdirSync(store, { recursive: true })
mkdirSync(path.join(legacy, "storage"), { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

// Upstream stores directories with forward slashes on every platform.
const slashed = (directory: string) => directory.replaceAll("\\", "/")

const rows = {
  sessions: [
    OpenCodeStore.session("ses_child", {
      parent: "ses_root",
      directory: slashed(project),
      title: "Explore",
      created: 120,
      updated: 130,
    }),
    OpenCodeStore.session("ses_root", {
      directory: slashed(project),
      title: "New session - 2026-01-01T00:00:00.000Z",
      created: 100,
      updated: 500,
    }),
    OpenCodeStore.session("ses_other", {
      directory: slashed(elsewhere),
      title: "Other work",
      created: 50,
      updated: 600,
    }),
    OpenCodeStore.session("ses_broken", { directory: slashed(elsewhere), title: "Broken", created: 1, updated: 1 }),
  ],
  messages: [
    OpenCodeStore.user("msg_r1", "ses_root", 100),
    OpenCodeStore.assistant("msg_r2", "ses_root", "msg_r1", 110),
    OpenCodeStore.user("msg_r3", "ses_root", 200),
    OpenCodeStore.assistant("msg_r4", "ses_root", "msg_r3", 210, { summary: true }),
    OpenCodeStore.user("msg_r5", "ses_root", 300),
    OpenCodeStore.assistant("msg_r6", "ses_root", "msg_r5", 310),
    OpenCodeStore.user("msg_c1", "ses_child", 120),
    OpenCodeStore.assistant("msg_c2", "ses_child", "msg_c1", 125),
    OpenCodeStore.user("msg_o1", "ses_other", 50),
    OpenCodeStore.user("broken_1", "ses_broken", 1),
  ],
  parts: [
    OpenCodeStore.part("prt_r1a", "msg_r1", "ses_root", { type: "text", text: "Fix   the failing\nbuild please" }),
    OpenCodeStore.part("prt_r2a", "msg_r2", "ses_root", { type: "step-start", snapshot: "snapshot-start" }),
    OpenCodeStore.part("prt_r2b", "msg_r2", "ses_root", { type: "text", text: "Looking" }),
    OpenCodeStore.part("prt_r2c", "msg_r2", "ses_root", {
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "ls" },
        output: "ok",
        title: "ls",
        metadata: {},
        time: { start: 111, end: 112 },
      },
    }),
    OpenCodeStore.part("prt_r3a", "msg_r3", "ses_root", { type: "compaction", auto: true }),
    OpenCodeStore.part("prt_r4a", "msg_r4", "ses_root", { type: "text", text: "Summary of work" }),
    OpenCodeStore.part("prt_r5a", "msg_r5", "ses_root", { type: "text", text: "Continue" }),
    OpenCodeStore.part("prt_r6a", "msg_r6", "ses_root", { type: "text", text: "Done" }),
    OpenCodeStore.part("prt_c1a", "msg_c1", "ses_child", { type: "text", text: "Explore the repo" }),
    OpenCodeStore.part("prt_c2a", "msg_c2", "ses_child", { type: "text", text: "Found it" }),
    OpenCodeStore.part("prt_o1a", "msg_o1", "ses_other", { type: "text", text: "Elsewhere" }),
  ],
}

OpenCodeStore.write(path.join(store, "opencode.db"), rows)

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
      SessionImport.node.replace(SessionImport.configured({ opencode: [empty, legacy, store], claudeCode: [empty] })),
    ],
  ),
)

describe("OpenCodeImport.normalize", () => {
  test("orders parents first, keeps source IDs, binds the canonical directory, and drops snapshots", () => {
    const result = OpenCodeImport.normalize(rows)
    expect(result.warnings).toEqual(["Skipped invalid message broken_1 in ses_broken"])
    expect(result.sessions.map((item) => [item.ref, item.data.info.parentID])).toEqual([
      ["ses_broken", undefined],
      ["ses_other", undefined],
      ["ses_root", undefined],
      ["ses_child", "ses_root"],
    ])
    const imported = result.sessions[2]!.data
    expect(imported.info.location.directory).toBe(AbsolutePath.make(project))
    expect(imported.messages.map((message) => [String(message.id), message.type])).toEqual([
      ["msg_r1", "user"],
      ["msg_r2", "assistant"],
      ["msg_r3", "compaction"],
      ["msg_r5", "user"],
      ["msg_r6", "assistant"],
    ])
    expect(imported.messages[1]).toMatchObject({
      content: [
        { type: "text", text: "Looking" },
        { type: "tool", name: "bash", state: { status: "completed" } },
      ],
    })
    expect(imported.messages[1]).not.toHaveProperty("snapshot")
    expect(imported.messages[2]).toMatchObject({ summary: "Summary of work", reason: "auto" })
    expect(imported.info).toMatchObject({ cost: 3, agent: "build", model: { id: "model", providerID: "provider" } })
  })

  test("roots a session whose parent is outside the rows and reports unreadable messages", () => {
    const result = OpenCodeImport.normalize({
      sessions: [rows.sessions[0]!],
      messages: [
        ...rows.messages.filter((row) => row.session_id === "ses_child"),
        OpenCodeStore.user("bad_id", "ses_child", 1),
      ],
      parts: rows.parts.filter((row) => row.session_id === "ses_child"),
    })
    expect(result.sessions.map((item) => [item.ref, item.data.info.parentID])).toEqual([["ses_child", undefined]])
    expect(result.sessions[0]!.data.messages.map((message) => String(message.id))).toEqual(["msg_c1", "msg_c2"])
    expect(result.warnings).toEqual(["Skipped invalid message bad_id in ses_child"])
  })
})

describe("SessionImport", () => {
  it.effect("detects the SQLite store and ignores older JSON storage when a database exists", () =>
    Effect.gen(function* () {
      const imports = yield* SessionImport.Service
      expect(yield* imports.sources()).toEqual([
        {
          source: "opencode",
          name: "OpenCode",
          available: true,
          path: path.join(store, "opencode.db"),
          sessions: 3,
        },
        {
          source: "claude-code",
          name: "Claude Code",
          available: false,
          sessions: 0,
          warning: "No Claude Code session store found",
        },
      ])
    }),
  )

  test("reports unsupported older OpenCode storage", async () => {
    const detected = await Effect.runPromise(OpenCodeImport.adapter({ directories: [empty, legacy] }).detect())
    expect(detected).toMatchObject({ available: false, sessions: 0, path: path.join(legacy, "storage") })
    expect(detected.warning).toContain("Unsupported older OpenCode storage")
    const missing = await Effect.runPromise(OpenCodeImport.adapter({ directories: [empty] }).detect())
    expect(missing).toEqual({
      source: "opencode",
      name: "OpenCode",
      available: false,
      sessions: 0,
      warning: "No OpenCode session store found",
    })
  })

  it.effect("lists recent root sessions, filtered by directory and limit", () =>
    Effect.gen(function* () {
      const imports = yield* SessionImport.Service
      const all = yield* imports.list("opencode")
      expect(all.map((item) => item.ref)).toEqual(["ses_other", "ses_root", "ses_broken"])
      expect((yield* imports.list("opencode", { limit: 1 })).map((item) => item.ref)).toEqual(["ses_other"])
      const local = yield* imports.list("opencode", { directory: slashed(project) })
      expect(local).toHaveLength(1)
      expect(local[0]).toMatchObject({
        ref: "ses_root",
        title: "Fix the failing build please",
        directory: project,
        messages: 6,
        subagents: 1,
        model: "provider/model",
      })
    }),
  )

  it.effect("imports a session tree parents first with provenance and a closing system note", () =>
    Effect.gen(function* () {
      const imports = yield* SessionImport.Service
      const sessions = yield* Session.Service
      const transfer = yield* SessionTransfer.Service
      const result = yield* imports.import("opencode", "ses_root")
      expect(result.sessions).toEqual([Session.ID.make("ses_root"), Session.ID.make("ses_child")])
      expect(result.session.location.directory).toBe(AbsolutePath.make(project))
      expect(result.session.metadata?.import).toMatchObject({
        source: "opencode",
        sourceID: "ses_root",
        sourceVersion: "1.18.7",
        path: path.join(store, "opencode.db"),
        warnings: [],
      })
      expect((yield* sessions.get(Session.ID.make("ses_child"))).parentID).toBe(Session.ID.make("ses_root"))
      const exported = yield* transfer.export({ sessionID: Session.ID.make("ses_root") })
      expect(exported.messages.map((message) => message.type)).toEqual([
        "user",
        "assistant",
        "compaction",
        "user",
        "assistant",
        "system",
      ])
      expect(exported.messages.at(-1)).toMatchObject({
        type: "system",
        description: "Imported from OpenCode · 5 messages · 1 subagent · 1 compaction",
      })

      const again = yield* imports.import("opencode", "ses_root").pipe(Effect.flip)
      expect(again).toEqual(new SessionImport.AlreadyImportedError({ sessionID: Session.ID.make("ses_root") }))
    }),
  )

  it.effect("requires a location when the recorded directory no longer exists", () =>
    Effect.gen(function* () {
      const imports = yield* SessionImport.Service
      const missing = yield* imports.import("opencode", "ses_other").pipe(Effect.flip)
      expect(missing).toEqual(new SessionImport.DirectoryNotFoundError({ directory: elsewhere }))
      const location = Location.Ref.make({ directory: AbsolutePath.make(project) })
      const result = yield* imports.import("opencode", "ses_other", { location })
      expect(result.session.location.directory).toBe(AbsolutePath.make(project))
      const broken = yield* imports.import("opencode", "ses_broken").pipe(Effect.flip)
      expect(broken).toEqual(
        new SessionImport.UnavailableError({
          source: "opencode",
          message:
            "OpenCode session ses_broken has no readable messages: Skipped invalid message broken_1 in ses_broken",
        }),
      )
      const unknown = yield* imports.import("opencode", "ses_unknown").pipe(Effect.flip)
      expect(unknown).toEqual(new SessionImport.NotFoundError({ source: "opencode", ref: "ses_unknown" }))
    }),
  )
})
