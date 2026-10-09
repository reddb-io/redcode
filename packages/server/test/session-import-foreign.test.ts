import { afterAll, expect } from "bun:test"
import { SessionImport } from "@opencode/core/session/import/service"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { OpenCodeStore } from "../../core/test/fixture/opencode-store"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "redcode-server-import-")))
const project = path.join(root, "project")
const store = path.join(root, "opencode")
mkdirSync(project, { recursive: true })
mkdirSync(store, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

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
    { overrides: [SessionImport.node.replace(SessionImport.configured({ opencode: [store] }))] },
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
