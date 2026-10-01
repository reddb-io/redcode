import { expect } from "bun:test"
import { Effect } from "effect"
import { Credential } from "../src/credential"
import { Integration } from "../src/integration"
import { IntegrationCheck } from "../src/integration-check"
import { ConnectionCheck } from "@opencode/schema/connection-check"
import { PluginTestLayer } from "./plugin/fixture"
import { testEffect } from "./lib/effect"

const it = testEffect(PluginTestLayer)

const checkCatalog = (body: string, status = 200) =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: (request) => {
            expect(new URL(request.url).pathname).toBe("/v1/models")
            expect(new URL(request.url).searchParams.get("capabilities")).toBe("chat")
            expect(request.headers.get("authorization")).toBe("Bearer selected-key")
            return new Response(body, { status })
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    const integrationID = Integration.ID.make("red-router")
    const integrations = yield* Integration.Service
    yield* integrations.transform((editor) =>
      editor.update(integrationID, (entry) => {
        entry.name = "RedRouter"
      }),
    )
    const credentials = yield* Credential.Service
    yield* credentials.create({
      integrationID,
      label: "Account",
      value: Credential.Key.make({ type: "key", key: "selected-key", configuration: { baseURL: `${server.url}v1` } }),
    })
    const report = yield* IntegrationCheck.check(integrationID)
    expect(report.requests[0]).toMatchObject({ status, bytes: new TextEncoder().encode(body).byteLength })
    expect(report.requests[0].durationMs).toBeGreaterThan(0)
    expect(ConnectionCheck.describe(report.requests)).not.toContain("selected-key")
    return report
  })

it.live("checks the active Router catalog without waiting for background model publication", () =>
  Effect.gen(function* () {
    const report = yield* checkCatalog(JSON.stringify({ data: [{ id: "chat-model" }, { id: "decision-model" }] }))
    expect(report.ok).toBe(true)
    expect(report.message).toContain("Generation was not checked")
    expect(report.requests[0].models).toBe(2)
  }),
)

it.live("HTTP 200 with an empty catalog is a failed check with zero visible models", () =>
  Effect.gen(function* () {
    const report = yield* checkCatalog('{"data":[]}')
    expect(report.ok).toBe(false)
    expect(report.requests[0].models).toBe(0)
    expect(report.message).toContain("empty model catalog")
  }),
)

it.live("an incompatible HTTP 200 response is a failed check with its original measurements", () =>
  Effect.gen(function* () {
    const report = yield* checkCatalog('{"models":["unexpected"]}')
    expect(report.ok).toBe(false)
    expect(report.message).toContain("not an OpenAI model catalog")
  }),
)

it.live("HTTP 401 is reported as the upstream result instead of the local API's HTTP status", () =>
  Effect.gen(function* () {
    const report = yield* checkCatalog('{"error":"Unauthorized"}', 401)
    expect(report.ok).toBe(false)
    expect(report.message).toContain("HTTP 401")
  }),
)
