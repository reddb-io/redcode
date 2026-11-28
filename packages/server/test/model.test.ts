import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect, Schedule, Schema } from "effect"
import { Model } from "@opencode/schema/model"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"
import { ServerFetch } from "../src/fetch"

it.live("serves catalog status and refresh over the authenticated server API", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("redcode-model-catalog-")))
    const file = path.join(tmp.path, "models.json")
    const write = (id: string) =>
      Effect.promise(() => fs.writeFile(file, JSON.stringify({
        openai: {
          id: "openai",
          name: "OpenAI",
          env: ["OPENAI_API_KEY"],
          models: {
            [id]: {
              id,
              name: id,
              type: "chat",
              release_date: "2026-01-01",
              modalities: { input: ["text"], output: ["text"] },
              capabilities: { tools: { supported: true }, reasoning: { supported: false }, temperature: true },
              limit: { context: 100_000, output: 8_000 },
              api: {
                "chat-completions": {
                  base_url: "https://example.test/v1",
                  sdk: { opencodeai: "@opencode/ai/providers/openai-compatible" },
                },
              },
            },
          },
        },
      })))
    yield* write("fixture-old")
    const handler = yield* ServerFetch.make({
      password: "fixture-secret",
      models: { file, fetch: false, snapshot: false },
      config: { project: false, global: false },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
    })
    const headers = { authorization: `Basic ${btoa("opencode:fixture-secret")}` }
    const url = "http://opencode.local/api/model-catalog"
    const unauthorized = yield* Effect.promise(() => handler(new Request(`${url}/refresh`, { method: "POST" })))
    expect(unauthorized.status).toBe(401)
    const status = yield* Effect.promise(() => handler(new Request(url, { headers })))
    expect(status.status).toBe(200)
    expect(yield* Effect.promise(() => status.json())).toEqual({
      source: "file", updatedAt: expect.any(Number), refreshEnabled: true,
    })
    yield* write("fixture-new")
    const refreshed = yield* Effect.promise(() => handler(new Request(`${url}/refresh`, { method: "POST", headers })))
    expect(refreshed.status).toBe(200)
    expect(yield* Effect.promise(() => refreshed.json())).toMatchObject({
      outcome: "updated", catalog: { source: "file", refreshEnabled: true },
    })
  }),
)

it.live("lists models without blocking on plugin initialization", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-model-endpoint-")))
    yield* Effect.promise(() =>
      fs.writeFile(
        path.join(tmp.path, "opencode.json"),
        JSON.stringify({
          providers: {
            custom: {
              package: "aisdk:@ai-sdk/openai-compatible",
              settings: { apiKey: "secret" },
              models: { chat: {} },
            },
          },
        }),
      ),
    )
    const server = yield* startServer(tmp.path)
    const url = new URL("/api/model", server.base)
    url.searchParams.set("location[directory]", tmp.path)
    const request = Effect.fnUntraced(function* () {
      const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
      expect(response.status).toBe(200)
      const body: unknown = yield* Effect.promise(() => response.json())
      if (!isRecord(body) || !Array.isArray(body["data"])) throw new Error("Expected a model list response")
      return body["data"].some((model) => isRecord(model) && model["providerID"] === "custom" && model["id"] === "chat")
    })
    yield* request().pipe(
      Effect.filterOrFail((found) => found),
      Effect.retry(Schedule.spaced("10 millis")),
      Effect.timeout("2 seconds"),
    )
  }),
)

it.live(
  "serves 2505 models and restores a saved session after restarting the server",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("redcode-large-catalog-")))
      const ids = Array.from({ length: 2505 }, (_, index) => `model-${index}`)
      const model = { providerID: "large-catalog", id: ids[ids.length - 1] }
      const sessionID = "ses_large_catalog"
      const headers = { authorization: `Basic ${btoa("opencode:secret")}`, "content-type": "application/json" }
      const boot = ServerFetch.make({
        app: { version: "test" },
        password: "secret",
        database: { path: path.join(tmp.path, "sessions.db") },
        config: {
          project: false,
          content: JSON.stringify({
            providers: {
              "large-catalog": {
                package: "@opencode/ai/providers/openai-compatible",
                settings: { apiKey: "secret", baseURL: "http://127.0.0.1:9/v1" },
                models: Object.fromEntries(ids.map((id) => [id, { limit: { context: 64_000, output: 4_000 } }])),
              },
            },
          }),
        },
        fs: { filewatcher: false },
        models: { fetch: false },
      })
      const catalog = (handler: (request: Request) => Promise<Response>) =>
        Effect.gen(function* () {
          const response = yield* Effect.promise(() =>
            handler(
              new Request(`http://opencode.local/api/model?location[directory]=${encodeURIComponent(tmp.path)}`, {
                headers,
              }),
            ),
          )
          expect(response.status).toBe(200)
          const body = yield* Effect.promise(() => response.json())
          const listed = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(Model.Info) }))(body)
          return listed.data.filter((item) => item.providerID === model.providerID)
        }).pipe(
          Effect.filterOrFail((listed) => listed.length === ids.length),
          Effect.retry(Schedule.spaced("10 millis")),
          Effect.timeout("10 seconds"),
        )
      yield* Effect.scoped(
        Effect.gen(function* () {
          const handler = yield* boot
          expect((yield* catalog(handler)).map((item) => item.id).sort()).toEqual([...ids].sort())
          const created = yield* Effect.promise(() =>
            handler(
              new Request("http://opencode.local/api/session", {
                method: "POST",
                headers,
                body: JSON.stringify({
                  id: sessionID,
                  location: { directory: tmp.path },
                  model,
                  title: "Keep this session",
                }),
              }),
            ),
          )
          expect(created.status).toBe(200)
          expect(yield* Effect.promise(() => created.json())).toMatchObject({ data: { id: sessionID, model } })
        }),
      )
      yield* Effect.scoped(
        Effect.gen(function* () {
          const handler = yield* boot
          expect(yield* catalog(handler)).toHaveLength(ids.length)
          const restored = yield* Effect.promise(() =>
            handler(new Request(`http://opencode.local/api/session/${sessionID}`, { headers })),
          )
          expect(restored.status).toBe(200)
          expect(yield* Effect.promise(() => restored.json())).toMatchObject({
            data: { id: sessionID, model, title: "Keep this session" },
          })
        }),
      )
    }),
  30_000,
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
