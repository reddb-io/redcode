export * as ReleaseMetadata from "./release-metadata.js"

import { Context, Effect, Layer, Option, Schema } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { EffectFlock } from "@opencode/util/effect-flock"
import { KV } from "./kv.js"

const Entry = Schema.Union([
  Schema.Struct({ status: Schema.Literal("ready"), until: Schema.Number, data: Schema.Json }),
  Schema.Struct({ status: Schema.Literal("failed"), until: Schema.Number, message: Schema.String }),
])

export interface Interface {
  /** Public release metadata only: credentials and model requests do not use this cache. */
  readonly get: (url: string) => Effect.Effect<Schema.Json, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ReleaseMetadata") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const flock = yield* EffectFlock.Service

    return Service.of({
      get: Effect.fn("ReleaseMetadata.get")(function* (url) {
        const origin = yield* Effect.try(() => new URL(url).origin)
        const key = `release-metadata:${url}`
        const hostKey = `release-metadata-limit:${origin}`
        // Serialize by origin so a rate-limit response blocks queued lookups for other releases too.
        return yield* flock
          .withLock(
            Effect.gen(function* () {
              const now = Date.now()
              const cached = Option.getOrUndefined(Schema.decodeUnknownOption(Entry)(yield* kv.get(key)))
              if (cached && cached.until > now) {
                if (cached.status === "ready") return cached.data
                return yield* Effect.fail(new Error(cached.message))
              }
              const limited = Option.getOrUndefined(Schema.decodeUnknownOption(Entry)(yield* kv.get(hostKey)))
              if (limited?.status === "failed" && limited.until > now)
                return yield* Effect.fail(new Error(limited.message))

              return yield* Effect.gen(function* () {
                const response = yield* Effect.tryPromise((signal) =>
                  fetch(url, {
                    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
                    headers: { Accept: "application/json" },
                  }),
                )
                if (!response.ok) {
                  const message = `Release lookup failed: HTTP ${response.status}`
                  if (response.status === 403 || response.status === 429) {
                    const retry = response.headers.get("retry-after")
                    const seconds = retry === null ? NaN : Number(retry)
                    const retryAt =
                      retry === null ? NaN : Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retry)
                    const reset = response.headers.get("x-ratelimit-reset")
                    const resetAt =
                      response.headers.get("x-ratelimit-remaining") === "0" && reset !== null
                        ? Number(reset) * 1000
                        : NaN
                    const until = Math.max(
                      Date.now() + 5 * 60_000,
                      Number.isFinite(retryAt) ? retryAt : 0,
                      Number.isFinite(resetAt) ? resetAt : 0,
                    )
                    yield* kv.set(hostKey, { status: "failed", until, message })
                  }
                  yield* Effect.promise(() => response.body?.cancel() ?? Promise.resolve())
                  return yield* Effect.fail(new Error(message))
                }
                const body = yield* Effect.tryPromise(() => response.json())
                const data = yield* Schema.decodeUnknownEffect(Schema.Json)(body)
                yield* kv.set(key, { status: "ready", until: Date.now() + 60 * 60_000, data })
                return data
              }).pipe(
                Effect.catch((error) =>
                  Effect.gen(function* () {
                    // Persist failures as well as successes so reloads and other projects cannot restart a request storm.
                    const message = error instanceof Error ? error.message : "Release lookup failed"
                    yield* kv.set(key, { status: "failed", until: Date.now() + 5 * 60_000, message })
                    return yield* Effect.fail(new Error(message))
                  }),
                ),
              )
            }),
            `release-metadata:${origin}`,
          )
          .pipe(Effect.mapError((error) => (error instanceof Error ? error : new Error("Release lookup unavailable"))))
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node, EffectFlock.node] })
