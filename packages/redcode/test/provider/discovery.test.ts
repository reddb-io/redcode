import { expect } from "bun:test"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { ProviderDiscovery } from "../../src/provider/discovery"
import { testEffect } from "../lib/effect"

const it = testEffect(FetchHttpClient.layer)

it.live(
  "times out a model catalog whose response body never finishes",
  () =>
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: () =>
              new Response(
                new ReadableStream({
                  start(controller) {
                    controller.enqueue(new TextEncoder().encode("{"))
                  },
                }),
              ),
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const http = yield* HttpClient.HttpClient
      const error = yield* ProviderDiscovery.discover(http, { baseURL: `${server.url}v1`, apiKey: "test" }).pipe(
        Effect.flip,
      )
      expect(error.message).toContain("took too long")
    }),
  15000,
)

it.effect("discovers routed IDs over HTTP, sends only the supplied key and normalizes the catalog", () =>
  Effect.gen(function* () {
    const requests: Array<{ path: string; auth: string | null }> = []
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            requests.push({ path: new URL(request.url).pathname, auth: request.headers.get("authorization") })
            return Response.json({
              data: [
                { id: "cc/claude-test", name: "Claude via router" },
                { id: "premium-coding" },
                { id: "premium-coding" },
                { id: "" },
                { id: "__proto__" },
              ],
            })
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    const http = yield* HttpClient.HttpClient
    const result = yield* ProviderDiscovery.discover(http, { baseURL: `${server.url}v1///`, apiKey: " test-key " })
    expect(requests).toEqual([{ path: "/v1/models", auth: "Bearer test-key" }])
    expect(result).toEqual({
      baseURL: `${server.url}v1`,
      models: [
        { id: "cc/claude-test", name: "Claude via router" },
        { id: "premium-coding", name: "premium-coding" },
      ],
    })
  }),
)

for (const scenario of [
  { status: 401, body: "secret-test-key", message: "refused this API key" },
  { status: 403, body: "secret-test-key", message: "refused this API key" },
  { status: 404, body: "not found", message: "HTTP 404" },
  { status: 500, body: "internal error", message: "HTTP 500" },
  { status: 200, body: "<html>dashboard</html>", message: "invalid model list" },
  { status: 200, body: JSON.stringify({ data: [{ id: 123 }] }), message: "invalid model list" },
  { status: 200, body: JSON.stringify({ data: [] }), message: "No models are available" },
]) {
  it.effect(`reports ${scenario.status} ${scenario.message} without echoing upstream bodies`, () =>
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: () => new Response(scenario.body, { status: scenario.status }),
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const http = yield* HttpClient.HttpClient
      const error = yield* ProviderDiscovery.discover(http, {
        baseURL: `${server.url}v1`,
        apiKey: "secret-test-key",
      }).pipe(Effect.flip)
      expect(error.message).toContain(scenario.message)
      expect(error.message).not.toContain("secret-test-key")
    }),
  )
}

it.effect("rejects invalid endpoints and credentials before making requests", () =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    for (const baseURL of [
      "garbage",
      "file:///tmp/key",
      "http://user:pass@localhost/v1",
      "http://localhost/v1?key=secret",
      "http://localhost/v1#fragment",
    ]) {
      const error = yield* ProviderDiscovery.discover(http, { baseURL, apiKey: "test" }).pipe(Effect.flip)
      expect(error._tag).toBe("ProviderDiscoveryError")
      expect(error.message).not.toContain("secret")
    }
    for (const apiKey of ["", "  ", "key\r\nheader: value"]) {
      const error = yield* ProviderDiscovery.discover(http, { baseURL: "http://127.0.0.1:1/v1", apiKey }).pipe(
        Effect.flip,
      )
      expect(error.message).toContain("Enter the API key")
    }
  }),
)
