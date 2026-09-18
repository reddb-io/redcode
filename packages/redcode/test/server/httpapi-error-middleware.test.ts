import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { NamedError } from "@reddb-io/redcode-core/util/error"
import { describe, expect } from "bun:test"
import { ConfigErrorV1 } from "@reddb-io/redcode-core/v1/config/error"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { errorLayer } from "../../src/server/routes/instance/httpapi/middleware/error"
import { NotFoundError } from "../../src/storage/storage"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(NodeHttpServer.layerTest, NodeServices.layer))

function expectUnknownErrorBody(body: unknown, cause: string) {
  expect(body).toMatchObject({ name: "UnknownError" })
  const data = (body as { data?: { message?: unknown; ref?: unknown } }).data
  const message = String(data?.message)
  expect(message).toContain("Unexpected server error")
  expect(message).toContain(cause)
  // The response names the file the full cause lives in.
  expect(message).toMatch(/Details in .+redcode\.log/)
  expect(data?.ref).toMatch(/^err_[0-9a-f-]{8}$/)
}

describe("HttpApi error middleware", () => {
  it.live("returns the cause and the log file for unknown 500 defects", () =>
    Effect.gen(function* () {
      const boom = new Error("boom cause")
      boom.stack = "Error: boom cause\n    at secretStackFrame (/tmp/boom.ts:1:1)"
      yield* HttpRouter.add("GET", "/boom", Effect.die(boom)).pipe(
        Layer.provide(errorLayer),
        HttpRouter.serve,
        Layer.build,
      )

      const response = yield* HttpClientRequest.get("/boom").pipe(HttpClient.execute)
      const body = yield* response.json

      expect(response.status).toBe(500)
      expectUnknownErrorBody(body, "boom cause")
      // The message may carry the cause, never the stack behind it.
      expect(JSON.stringify(body)).not.toContain("secretStackFrame")
    }),
  )

  it.live("returns the named cause for named defects", () =>
    Effect.gen(function* () {
      yield* HttpRouter.add(
        "GET",
        "/named",
        Effect.die(new NamedError.Unknown({ message: "named failure cause" })),
      ).pipe(Layer.provide(errorLayer), HttpRouter.serve, Layer.build)

      const response = yield* HttpClientRequest.get("/named").pipe(HttpClient.execute)
      const body = yield* response.json

      expect(response.status).toBe(500)
      expectUnknownErrorBody(body, "named failure cause")
    }),
  )

  it.live("returns invalid config defects as structured client errors", () =>
    Effect.gen(function* () {
      const configError = new ConfigErrorV1.InvalidError({
        path: "/tmp/opencode.json",
        issues: [{ message: "Expected object", path: ["provider", "anthropic", "options"] }],
      })

      yield* HttpRouter.add("GET", "/config-error", Effect.die(configError)).pipe(
        Layer.provide(errorLayer),
        HttpRouter.serve,
        Layer.build,
      )

      const response = yield* HttpClientRequest.get("/config-error").pipe(HttpClient.execute)
      const body = yield* response.json
      const serialized = JSON.stringify(body)

      expect(response.status).toBe(400)
      expect(body).toMatchObject({
        name: "ConfigInvalidError",
        data: {
          path: "/tmp/opencode.json",
          issues: [{ message: "Expected object", path: ["provider", "anthropic", "options"] }],
        },
      })
      expect(serialized).toContain("/tmp/opencode.json")
      expect(serialized).toContain("anthropic")
    }),
  )

  it.live("does not map storage not-found defects to 404", () =>
    Effect.gen(function* () {
      yield* HttpRouter.add(
        "GET",
        "/missing",
        Effect.die(new NotFoundError({ message: "Resource not found: secret" })),
      ).pipe(Layer.provide(errorLayer), HttpRouter.serve, Layer.build)

      const response = yield* HttpClientRequest.get("/missing").pipe(HttpClient.execute)
      const body = yield* response.json

      expect(response.status).toBe(500)
      expectUnknownErrorBody(body, "Resource not found: secret")
    }),
  )
})
