import { expect } from "bun:test"
import { Effect, Fiber, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import { AIError, RateLimitError } from "@opencode/ai"
import { RequestExecutor, WebSocketTransport, type WebSocketChannelExchange } from "@opencode/ai/route"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { ProviderHealth } from "@opencode/core/provider-health"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([LayerNodePlatform.requestExecutor, LayerNodePlatform.webSocketConstructor, ProviderHealth.node]),
  ),
)

it.effect("WebSocket failures coordinate HTTP and WebSocket recovery for the same account", () =>
  Effect.gen(function* () {
    let sockets = 0
    let requests = 0
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request, server) => {
        if (request.headers.get("upgrade") === "websocket" && server.upgrade(request)) return
        requests++
        return Response.json({ ok: true })
      },
      websocket: {
        open() {
          sockets++
        },
        message(socket) {
          socket.send(sockets === 1 ? "limited" : "ok")
        },
      },
    })
    yield* Effect.addFinalizer(() => Effect.promise(() => server.stop(true)))
    const health = yield* ProviderHealth.Service
    const direct = yield* WebSocketTransport.direct
    const executor = health.webSocket(direct)
    const http = yield* RequestExecutor.Service
    const headers = Headers.fromInput({ authorization: "Bearer account-a" })
    const exchange: WebSocketChannelExchange = {
      id: "test-channel",
      connect: { url: server.url.href.replace("http:", "ws:"), headers },
      fallback: () => Stream.empty,
      driver: {
        create: () => Effect.succeed({ message: "request", mode: "full" }),
        observe: (_, frame) =>
          Effect.succeed(
            frame === "limited"
              ? {
                  type: "provider-failure",
                  error: new AIError({ reason: new RateLimitError({ message: "busy", retryAfterMs: 1000 }) }),
                }
              : { type: "completed", frame },
          ),
      },
    }
    const initial = yield* executor.execute(exchange)
    expect((yield* Stream.runDrain(initial.frames).pipe(Effect.flip)).reason._tag).toBe("RateLimit")
    const send = (token = "account-a") =>
      http.execute(
        HttpClientRequest.post(server.url.href, {
          headers: { authorization: `Bearer ${token}` },
        }),
        undefined,
        { rawResponse: true },
      )
    expect((yield* send()).status).toBe(429)
    expect((yield* executor.execute(exchange).pipe(Effect.flip)).reason._tag).toBe("RateLimit")
    expect(sockets).toBe(1)
    expect(requests).toBe(0)
    expect((yield* send("account-b")).status).toBe(200)
    yield* TestClock.adjust("1 second")
    const probe = yield* executor.execute(exchange)
    expect((yield* send()).status).toBe(429)
    yield* Stream.runDrain(probe.frames)
    yield* probe.complete
    expect((yield* send()).status).toBe(200)
    expect(sockets).toBe(2)
    expect(requests).toBe(2)
  }),
)

it.effect("coordinates authenticated requests across sessions and admits one recovery probe", () =>
  Effect.gen(function* () {
    let calls = 0
    let accountCalls = 0
    let release = () => {}
    let seen = () => {}
    const probe = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      seen = resolve
    })
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (request) => {
        calls++
        if (request.headers.get("authorization") !== "Bearer account-a") return Response.json({ ok: true })
        accountCalls++
        if (accountCalls === 1)
          return Response.json({ error: "busy" }, { status: 429, headers: { "retry-after": "1" } })
        if (accountCalls === 2) {
          seen()
          await probe
        }
        return Response.json({ ok: true })
      },
    })
    yield* Effect.addFinalizer(() => Effect.promise(() => server.stop(true)))
    const executor = yield* RequestExecutor.Service
    const request = (session: string, token = "account-a") =>
      HttpClientRequest.post(server.url.href, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-opencode-session": session,
        },
      })
    const send = (session: string, token?: string) =>
      executor.execute(request(session, token), undefined, { rawResponse: true })
    expect((yield* send("first")).status).toBe(429)
    const held = yield* Effect.all(
      Array.from({ length: 20 }, (_, index) => send(`waiting-${index}`)),
      { concurrency: "unbounded" },
    )
    expect(held.every((response) => response.status === 429)).toBe(true)
    expect(calls).toBe(1)
    const error = yield* executor.execute(request("typed-error")).pipe(Effect.flip)
    expect(error.reason._tag).toBe("RateLimit")
    expect((yield* send("other", "account-b")).status).toBe(200)
    yield* TestClock.adjust("1 second")
    const recovering = yield* send("probe").pipe(Effect.forkScoped)
    yield* Effect.promise(() => started)
    expect((yield* send("not-another-probe")).status).toBe(429)
    expect(accountCalls).toBe(2)
    release()
    expect((yield* Fiber.join(recovering)).status).toBe(200)
    expect((yield* send("recovered")).status).toBe(200)
    expect(accountCalls).toBe(3)
  }),
)

it.effect("an older successful request cannot clear a newer cooldown", () =>
  Effect.gen(function* () {
    let calls = 0
    let release = () => {}
    let seen = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      seen = resolve
    })
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async () => {
        calls++
        if (calls === 1) {
          seen()
          await held
          return Response.json({ ok: true })
        }
        return Response.json({ error: "busy" }, { status: 429, headers: { "retry-after": "10" } })
      },
    })
    yield* Effect.addFinalizer(() => Effect.promise(() => server.stop(true)))
    const executor = yield* RequestExecutor.Service
    const request = HttpClientRequest.post(server.url.href)
    const old = yield* executor.execute(request, undefined, { rawResponse: true }).pipe(Effect.forkScoped)
    yield* Effect.promise(() => started)
    yield* executor.execute(request, undefined, { rawResponse: true })
    release()
    expect((yield* Fiber.join(old)).status).toBe(200)
    expect((yield* executor.execute(request, undefined, { rawResponse: true })).status).toBe(429)
    expect(calls).toBe(2)
  }),
)

it.effect("repeated upstream failures open a shared circuit without retrying healthy accounts", () =>
  Effect.gen(function* () {
    let calls = 0
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => {
        calls++
        return Response.json({ error: "overloaded" }, { status: 503 })
      },
    })
    yield* Effect.addFinalizer(() => Effect.promise(() => server.stop(true)))
    const executor = yield* RequestExecutor.Service
    const request = HttpClientRequest.post(server.url.href)
    for (let count = 0; count < 5; count++) yield* executor.execute(request, undefined, { rawResponse: true })
    const held = yield* executor.execute(request, undefined, { rawResponse: true })
    expect(held.status).toBe(503)
    expect(Number(held.headers["retry-after-ms"])).toBe(60_000)
    expect(calls).toBe(5)
    yield* TestClock.adjust("60 seconds")
    yield* executor.execute(request, undefined, { rawResponse: true })
    expect(calls).toBe(6)
  }),
)
