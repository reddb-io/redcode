import { afterAll, expect } from "bun:test"
import { SessionImport } from "@opencode/core/session/import/service"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { ClaudeCodeStore } from "../../core/test/fixture/claude-code-store"
import { OpenCodeStore } from "../../core/test/fixture/opencode-store"
import { PiStore } from "../../core/test/fixture/pi-store"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "redcode-server-import-")))
const project = path.join(root, "project")
const store = path.join(root, "opencode")
const claude = path.join(root, "claude")
const pi = path.join(root, "pi", "sessions")
const omp = path.join(root, "omp", "sessions")
mkdirSync(project, { recursive: true })
mkdirSync(store, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

const CLAUDE_SESSION = "33333333-3333-4333-8333-333333333333"
const cc = ClaudeCodeStore.transcript(CLAUDE_SESSION, project)
ClaudeCodeStore.write(claude, {
  cwd: project,
  session: CLAUDE_SESSION,
  records: [
    cc.user("u1", null, 1, "Hello from Claude Code"),
    cc.assistant("a1", "u1", 2, { id: "msg_1", block: { type: "text", text: "Hi" }, stop: "end_turn" }),
  ],
})

const OMP_SESSION = "019c625b-b900-7000-8000-000000000001"
PiStore.write(omp, {
  bucket: PiStore.bucket(project),
  file: `2026-01-01T00-00-00-000Z_${OMP_SESSION}`,
  records: [
    PiStore.header(OMP_SESSION, project, 0),
    PiStore.user("u1", null, 1, "Hello from oh-my-pi"),
    PiStore.assistant("a1", "u1", 2, [{ type: "text", text: "Hi" }]),
  ],
})

OpenCodeStore.write(path.join(store, "opencode.db"), {
  sessions: [
    OpenCodeStore.session("ses_foreign", { directory: project, title: "Foreign work", created: 1, updated: 10 }),
    OpenCodeStore.session("ses_foreign_child", {
      parent: "ses_foreign",
      directory: project,
      title: "Subagent",
      created: 2,
      updated: 3,
    }),
    OpenCodeStore.session("ses_moved", {
      directory: path.join(root, "gone"),
      title: "Moved work",
      created: 4,
      updated: 5,
    }),
  ],
  messages: [
    OpenCodeStore.user("msg_f1", "ses_foreign", 1),
    OpenCodeStore.assistant("msg_f2", "ses_foreign", "msg_f1", 2),
    OpenCodeStore.user("msg_c1", "ses_foreign_child", 2),
  ],
  parts: [
    OpenCodeStore.part("prt_f1", "msg_f1", "ses_foreign", { type: "text", text: "Hello" }),
    OpenCodeStore.part("prt_f2", "msg_f2", "ses_foreign", { type: "text", text: "Hi" }),
    OpenCodeStore.part("prt_c1", "msg_c1", "ses_foreign_child", { type: "text", text: "Look around" }),
  ],
})

const setup = Effect.gen(function* () {
  const handler = yield* ServerFetch.make(
    { app: { version: "test" }, database: { path: ":memory:" }, fs: { filewatcher: false } },
    {
      overrides: [
        SessionImport.node.replace(
          SessionImport.configured({ opencode: [store], claudeCode: [claude], pi: [pi], omp: [omp] }),
        ),
      ],
    },
  )
  return (url: string, body?: unknown, status = 200) =>
    Effect.promise(async () => {
      const response = await handler(
        new Request(`http://opencode.local${url}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      )
      const json: unknown = await response.json()
      expect({ url, status: response.status }).toEqual({ url, status })
      return json
    })
})

it.live("lists import sources and the sessions recorded in a directory", () =>
  Effect.gen(function* () {
    const request = yield* setup
    expect(yield* request("/api/experimental/session/import/sources")).toEqual({
      data: [
        { source: "opencode", name: "OpenCode", available: true, path: path.join(store, "opencode.db"), sessions: 2 },
        {
          source: "claude-code",
          name: "Claude Code",
          available: true,
          path: path.join(claude, "projects"),
          sessions: 1,
        },
        { source: "pi", name: "Pi", available: false, sessions: 0, warning: "No Pi session store found" },
        { source: "omp", name: "oh-my-pi", available: true, path: omp, sessions: 1 },
      ],
    })
    expect(
      yield* request(
        `/api/experimental/session/import/sessions?source=opencode&directory=${encodeURIComponent(project)}`,
      ),
    ).toEqual({
      data: [
        {
          source: "opencode",
          ref: "ses_foreign",
          title: "Foreign work",
          directory: project,
          messages: 2,
          subagents: 1,
          model: "provider/model",
          time: { created: 1, updated: 10 },
        },
      ],
    })
    expect(yield* request("/api/experimental/session/import/sessions?source=unknown", undefined, 400)).toMatchObject({
      _tag: "InvalidRequestError",
    })
  }).pipe(Effect.scoped),
)

it.live("imports a foreign session once and reports later imports as conflicts", () =>
  Effect.gen(function* () {
    const request = yield* setup
    const imported = yield* request("/api/experimental/session/import/foreign", {
      source: "opencode",
      ref: "ses_foreign",
    })
    expect(imported).toMatchObject({
      data: {
        session: { id: "ses_foreign", title: "Foreign work", location: { directory: project } },
        sessions: ["ses_foreign", "ses_foreign_child"],
        warnings: [],
      },
    })
    expect(yield* request("/api/session/ses_foreign_child")).toMatchObject({ data: { parentID: "ses_foreign" } })
    expect(
      yield* request("/api/experimental/session/import/foreign", { source: "opencode", ref: "ses_foreign" }, 409),
    ).toMatchObject({ _tag: "ConflictError", resource: "ses_foreign" })
    expect(
      yield* request("/api/experimental/session/import/foreign", { source: "opencode", ref: "ses_missing" }, 404),
    ).toMatchObject({ _tag: "SessionNotFoundError", sessionID: "ses_missing" })
  }).pipe(Effect.scoped),
)

it.live("requires a location for a session whose directory no longer exists", () =>
  Effect.gen(function* () {
    const request = yield* setup
    expect(
      yield* request("/api/experimental/session/import/foreign", { source: "opencode", ref: "ses_moved" }, 404),
    ).toMatchObject({ _tag: "LocationNotFoundError", location: { directory: path.join(root, "gone") } })
    expect(
      yield* request("/api/experimental/session/import/foreign", {
        source: "opencode",
        ref: "ses_moved",
        location: { directory: project },
      }),
    ).toMatchObject({ data: { session: { id: "ses_moved", location: { directory: project } } } })
  }).pipe(Effect.scoped),
)

it.live("lists and imports a Claude Code session under a stable Redcode ID", () =>
  Effect.gen(function* () {
    const request = yield* setup
    expect(
      yield* request(
        `/api/experimental/session/import/sessions?source=claude-code&directory=${encodeURIComponent(project)}`,
      ),
    ).toMatchObject({
      data: [
        {
          source: "claude-code",
          ref: CLAUDE_SESSION,
          title: "Hello from Claude Code",
          directory: project,
          messages: 2,
          subagents: 0,
          model: "anthropic/claude-test-1",
        },
      ],
    })
    const imported = yield* request("/api/experimental/session/import/foreign", {
      source: "claude-code",
      ref: CLAUDE_SESSION,
    })
    expect(imported).toMatchObject({
      data: { session: { title: "Hello from Claude Code", location: { directory: project } }, warnings: [] },
    })
    const id = (imported as { data: { session: { id: string } } }).data.session.id
    expect(id).toStartWith("ses_")
    expect(
      yield* request("/api/experimental/session/import/foreign", { source: "claude-code", ref: CLAUDE_SESSION }, 409),
    ).toMatchObject({ _tag: "ConflictError", resource: id })
  }).pipe(Effect.scoped),
)

it.live("lists and imports an oh-my-pi session under a stable Redcode ID", () =>
  Effect.gen(function* () {
    const request = yield* setup
    expect(
      yield* request(`/api/experimental/session/import/sessions?source=omp&directory=${encodeURIComponent(project)}`),
    ).toMatchObject({
      data: [
        {
          source: "omp",
          ref: OMP_SESSION,
          title: "Hello from oh-my-pi",
          directory: project,
          messages: 2,
          subagents: 0,
          model: "anthropic/claude-test-1",
        },
      ],
    })
    const imported = yield* request("/api/experimental/session/import/foreign", { source: "omp", ref: OMP_SESSION })
    expect(imported).toMatchObject({
      data: { session: { title: "Hello from oh-my-pi", location: { directory: project } }, warnings: [] },
    })
    const id = (imported as { data: { session: { id: string } } }).data.session.id
    expect(id).toStartWith("ses_")
    expect(
      yield* request("/api/experimental/session/import/foreign", { source: "omp", ref: OMP_SESSION }, 409),
    ).toMatchObject({ _tag: "ConflictError", resource: id })
  }).pipe(Effect.scoped),
)
