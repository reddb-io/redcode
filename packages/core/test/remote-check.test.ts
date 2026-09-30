import { expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ConnectionCheck } from "@opencode/schema/connection-check"
import { RemoteCheck } from "../src/remote-check"

// Exercise the real body reader over HTTP, including time spent receiving the body.
test.each([200, 401, 503])(
  "remote checks retain HTTP %i, body bytes and latency without leaking query credentials",
  async (status) => {
    const body = JSON.stringify({ message: "Olá 🌍" })
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(new TextEncoder().encode(body.slice(0, 10)))
              await Bun.sleep(25)
              controller.enqueue(new TextEncoder().encode(body.slice(10)))
              controller.close()
            },
          }),
          { status },
        ),
    })
    try {
      const requests: ConnectionCheck.Request[] = []
      const response = await RemoteCheck.request(
        `${server.url}models?api_key=secret&capabilities=chat#private`,
        {},
        requests,
      )
      expect(await response.text()).toBe(body)
      expect(requests[0]).toMatchObject({ status, bytes: new TextEncoder().encode(body).byteLength, method: "GET" })
      expect(requests[0].durationMs).toBeGreaterThanOrEqual(20)
      expect(requests[0].url).toBe(`${server.url}models?capabilities=chat`)
      expect(ConnectionCheck.describe(requests)).toContain(`HTTP ${status}`)
      expect(ConnectionCheck.describe(requests)).not.toContain("secret")
    } finally {
      await server.stop(true)
    }
  },
)

test.each([200, 401, 204])(
  "generation probe middleware preserves the response and measures HTTP %i",
  async (status) => {
    const body = status === 204 ? "" : "upstream response — ✓"
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(body || null, { status }) })
    try {
      const requests: ConnectionCheck.Request[] = []
      const response = await Effect.runPromise(
        RemoteCheck.http(requests)(
          HttpClientRequest.get(`${server.url}probe`).pipe(HttpClientRequest.setUrlParam("api_key", "secret")),
          (request) =>
            Effect.tryPromise({
              try: () => fetch(request.url),
              catch: (error) => (error instanceof Error ? error : new Error("HTTP request failed")),
            }).pipe(Effect.map((response) => HttpClientResponse.fromWeb(request, response))),
        ),
      )
      expect(await Effect.runPromise(response.text)).toBe(body)
      expect(requests[0]).toMatchObject({ status, bytes: new TextEncoder().encode(body).byteLength })
      expect(requests[0].durationMs).toBeGreaterThan(0)
      expect(requests[0].url).not.toContain("secret")
    } finally {
      await server.stop(true)
    }
  },
)

test("a timed out remote check reports no HTTP response rather than inventing status 200", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async () => {
      await Bun.sleep(100)
      return new Response("late")
    },
  })
  try {
    const requests: ConnectionCheck.Request[] = []
    await expect(RemoteCheck.request(server.url.href, { signal: AbortSignal.timeout(10) }, requests)).rejects.toThrow()
    expect(requests[0]).toMatchObject({ failure: "timeout", bytes: 0 })
    expect(requests[0].status).toBeUndefined()
    expect(requests[0].durationMs).toBeGreaterThan(0)
    expect(ConnectionCheck.describe(requests)).toContain("No HTTP response")
  } finally {
    await server.stop(true)
  }
})
