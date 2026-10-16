export * as ProviderHealth from "./provider-health.js"

import { Clock, Context, Effect, Layer, Stream } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { AIError, ProviderInternalError, RateLimitError } from "@opencode/ai"
import type { HttpHandler, WebSocketChannelExecutor } from "@opencode/ai/route"
import { Hash } from "@opencode/util/hash"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

type Health = { failures: number; until: number; version: number; probe?: symbol; touched: number; status: 429 | 503 }

export interface Interface {
  /** Runs after authentication and request hooks, so different credentials never share a circuit. */
  readonly execute: (request: HttpClientRequest.HttpClientRequest, handler: HttpHandler) => ReturnType<HttpHandler>
  readonly webSocket: (executor: WebSocketChannelExecutor) => WebSocketChannelExecutor
}

export class Service extends Context.Service<Service, Interface>()("@redcode/ProviderHealth") {}

const maximumWait = 15 * 60_000
const volatile =
  /^(content-length|content-type|accept|accept-encoding|user-agent|date|traceparent|tracestate|baggage|x-request-id|x-session-affinity|x-session-id|x-parent-session-id|x-(opencode|redcode)-(session|project|client))$/i

function identity(request: HttpClientRequest.HttpClientRequest) {
  const url = new URL(request.url)
  if (url.protocol === "ws:") url.protocol = "http:"
  if (url.protocol === "wss:") url.protocol = "https:"
  // Keep arbitrary credential/tenant headers and query credentials; never keep or log their plaintext.
  return Hash.sha256(
    JSON.stringify([
      url.origin,
      url.username,
      url.password,
      url.search,
      request.urlParams,
      Object.entries(request.headers)
        .filter(([name]) => !volatile.test(name))
        .sort(([a], [b]) => a.localeCompare(b)),
    ]),
  )
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const states = new Map<string, Health>()
    let generation = 0
    const enter = (request: HttpClientRequest.HttpClientRequest) =>
      Effect.gen(function* () {
        const key = identity(request)
        const now = yield* Clock.currentTimeMillis
        const state = states.get(key)
        if (state && (state.until > now || state.probe))
          return { allowed: false as const, state, key, wait: state.until > now ? state.until - now : 30_000 }
        const version = state?.version ?? 0
        const probe = state && state.until > 0 ? Symbol() : undefined
        if (state) state.probe = probe
        return { allowed: true as const, state, key, version, probe }
      })
    type Permit = Extract<Effect.Success<ReturnType<typeof enter>>, { allowed: true }>
    const release = (permit: Permit) =>
      Effect.sync(() => {
        if (permit.probe && permit.state?.probe === permit.probe) permit.state.probe = undefined
      })
    const success = (permit: Permit) =>
      Effect.sync(() => {
        if (states.get(permit.key)?.version === permit.version) states.delete(permit.key)
      })
    const failed = (key: string, response?: HttpClientResponse.HttpClientResponse) =>
      Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis
        const current = states.get(key) ?? { failures: 0, until: 0, version: 0, touched: at, status: 503 as const }
        current.failures++
        current.version = ++generation
        current.touched = at
        current.status = response?.status === 429 ? 429 : 503
        const millis = Number.parseFloat(response?.headers["retry-after-ms"] ?? "")
        const seconds = Number.parseFloat(response?.headers["retry-after"] ?? "")
        const date = Date.parse(response?.headers["retry-after"] ?? "") - at
        const supplied = Number.isFinite(millis) ? millis : Number.isFinite(seconds) ? seconds * 1000 : date
        const wait =
          current.status === 429 || Number.isFinite(supplied)
            ? Number.isFinite(supplied)
              ? Math.max(1000, supplied)
              : Math.min(60_000, 2_000 * 2 ** Math.min(current.failures - 1, 5))
            : current.failures >= 5
              ? Math.min(maximumWait, 60_000 * 2 ** Math.min(current.failures - 5, 4))
              : 0
        if (wait > 0) current.until = Math.max(current.until, at + Math.min(maximumWait, wait))
        // Retain failure records only; stale circuits cannot grow with a long-lived server's catalog.
        if (!states.has(key)) {
          for (const [id, entry] of states) {
            if (!entry.probe && entry.until <= at && at - entry.touched >= maximumWait) states.delete(id)
          }
          if (states.size >= 4096) {
            const oldest = Array.from(states).find(([, entry]) => !entry.probe && entry.until <= at)
            if (oldest) states.delete(oldest[0])
            else return
          }
        }
        states.set(key, current)
      })
    return Service.of({
      execute: (request, handler) =>
        Effect.gen(function* () {
          if (request.method !== "POST") return yield* handler(request)
          const permit = yield* enter(request)
          if (!permit.allowed) {
            return HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify({
                  error: {
                    message:
                      "Requests using this provider account are waiting for recovery; retry after the shared cooldown.",
                  },
                }),
                {
                  status: permit.state.status,
                  headers: { "content-type": "application/json", "retry-after-ms": String(permit.wait) },
                },
              ),
            )
          }
          return yield* handler(request).pipe(
            Effect.tap((response) =>
              Effect.suspend(() => {
                if (response.status !== 429 && (response.status < 500 || response.status === 501)) {
                  return success(permit)
                }
                return failed(permit.key, response)
              }),
            ),
            Effect.tapError(() => failed(permit.key)),
            Effect.ensuring(release(permit)),
          )
        }),
      webSocket: (executor) => ({
        execute: (exchange) =>
          Effect.gen(function* () {
            const request = HttpClientRequest.post(exchange.connect.url, { headers: exchange.connect.headers })
            const permit = yield* enter(request)
            if (!permit.allowed) {
              const message =
                "Requests using this provider account are waiting for recovery; retry after the shared cooldown."
              return yield* new AIError({
                reason:
                  permit.state.status === 429
                    ? new RateLimitError({ message, retryAfterMs: permit.wait })
                    : new ProviderInternalError({ message, retryAfterMs: permit.wait }),
              })
            }
            // The stream's request scope also releases a probe on cancellation or failed decoding.
            yield* Effect.addFinalizer(() => release(permit))
            const observe = (error: AIError) => {
              const reason = error.reason
              // A broken partial stream is not evidence of an overloaded provider.
              if (reason._tag !== "RateLimit" && reason._tag !== "ProviderInternal") return Effect.void
              const response = HttpClientResponse.fromWeb(
                request,
                new Response(null, {
                  status: reason._tag === "RateLimit" ? 429 : 503,
                  headers: reason.retryAfterMs === undefined ? {} : { "retry-after-ms": String(reason.retryAfterMs) },
                }),
              )
              return failed(permit.key, response)
            }
            const execution = yield* executor.execute(exchange).pipe(Effect.tapError(observe))
            return {
              ...execution,
              get http() {
                // Session channels select their connection when frames start.
                return execution.http
              },
              frames: execution.frames.pipe(Stream.tapError(observe)),
              complete: execution.complete.pipe(Effect.andThen(success(permit)), Effect.ensuring(release(permit))),
            }
          }),
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
