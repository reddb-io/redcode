import { WorkerFencing } from "@opencode/protocol/middleware/worker-fencing"
import { ConflictError } from "@opencode/protocol/errors"
import { WorkerLease } from "@opencode/core/worker-lease"
import { Session } from "@opencode/schema/session"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/unstable/http"

const decodeFence = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkerLease.Fence))
const createID = Schema.Struct({ id: Schema.optional(Session.ID) })
export const workerFencingLayer = Layer.effect(
  WorkerFencing,
  Effect.gen(function* () {
    const leases = yield* WorkerLease.Service
    return WorkerFencing.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return yield* effect
        const pathname = new URL(request.url, "http://localhost").pathname
        const match = /^\/api\/session\/([^/]+)(?:\/(.*))?$/.exec(pathname)
        const route = yield* HttpRouter.RouteContext
        const id =
          route.params.sessionID ??
          (pathname === "/api/session"
            ? (yield* request.json.pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(createID)),
                Effect.catch(() => Effect.succeed({ id: undefined })),
              )).id
            : undefined)
        if (!id || id === "global") return yield* effect
        const sessionID = yield* Schema.decodeUnknownEffect(Session.ID)(id).pipe(
          Effect.mapError(() => new ConflictError({ message: "Invalid worker Session", resource: "worker-lease" })),
        )
        const fence = request.headers["x-redcode-worker-fence"]
          ? yield* decodeFence(request.headers["x-redcode-worker-fence"]).pipe(
              Effect.mapError(() => new ConflictError({ message: "Invalid worker fence", resource: "worker-lease" })),
            )
          : undefined
        return yield* Effect.acquireUseRelease(
          leases
            .enter(sessionID, fence)
            .pipe(Effect.mapError((error) => new ConflictError({ message: error.message, resource: "worker-lease" }))),
          (operation) =>
            Effect.gen(function* () {
              if (operation && ((request.method === "DELETE" && !match?.[2]) || /^(move|fork)$/.test(match?.[2] ?? "")))
                return yield* new ConflictError({
                  message: "A managed worker assignment must retain its Session and checkout",
                  resource: "worker-lease",
                })
              return yield* effect
            }),
          (operation) => leases.leave(operation),
        )
      }),
    )
  }),
)
