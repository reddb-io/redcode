import { expect } from "bun:test"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import path from "node:path"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request } from "./httpapi-layer"

const it = testEffect(httpApiLayer)
const authenticated = testEffect(
  httpApiLayer.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ REDCODE_SERVER_PASSWORD: "secret" }))),
  ),
)

authenticated.instance("MCP reload requires configured server credentials", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
    const missing = yield* request("/mcp/reload", { method: "POST", headers, body: "{}" })
    expect(missing.status).toBe(401)
    const valid = yield* request("/mcp/reload", {
      method: "POST",
      headers: { ...headers, authorization: `Basic ${Buffer.from("redcode:secret").toString("base64")}` },
      body: "{}",
    })
    expect(valid.status).toBe(200)
  }),
)

it.instance(
  "MCP reload reports config errors and keeps the same session usable after retry",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
      const created = yield* request("/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Keep this conversation" }),
      })
      expect(created.status).toBe(200)
      const session = yield* created.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.String, title: Schema.String }))),
      )
      yield* request("/mcp", { headers })
      const file = path.join(test.directory, "opencode.json")
      yield* Effect.promise(() => Bun.write(file, "{ invalid"))
      const invalid = yield* request("/mcp/reload", { method: "POST", headers, body: "{}" })
      expect(invalid.status).toBe(400)
      expect(yield* invalid.json).toEqual({
        message:
          "Could not reload MCP configuration. Check your config files and retry. Existing MCP connections were kept.",
      })

      yield* Effect.promise(() =>
        Bun.write(
          file,
          JSON.stringify({ mcp: { disabled: { type: "local", command: ["not-launched"], enabled: false } } }),
        ),
      )
      const reloaded = yield* request("/mcp/reload", { method: "POST", headers, body: "{}" })
      expect(reloaded.status).toBe(200)
      expect(yield* reloaded.json).toEqual({ disabled: { status: "disabled" } })
      const missing = yield* request("/mcp/reload", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "missing" }),
      })
      expect(missing.status).toBe(404)
      const resumed = yield* request(`/session/${session.id}`, { headers })
      expect(resumed.status).toBe(200)
      expect(yield* resumed.json).toMatchObject(session)
    }),
  { config: { formatter: false, lsp: false } },
)
