import { LocationServiceMap } from "@opencode/core/location-service-map"
import { SessionGuardLog } from "@opencode/core/session/guard-log"
import { Effect, Option, RcMap } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { requestRef } from "../location"

export const DebugHandler = HttpApiBuilder.group(Api, "server.debug", (handlers) =>
  handlers
    .handle(
      "debug.guards",
      Effect.fn(function* (ctx) {
        const guards = yield* SessionGuardLog.Service
        return {
          summary: yield* guards.summary({ since: ctx.query.since }),
          recent: yield* guards.recent({ since: ctx.query.since, limit: ctx.query.limit ?? 20 }),
        }
      }),
    )
    .handle(
      "debug.location",
      Effect.fn(function* () {
        const locations = Option.getOrThrow(yield* Effect.serviceOption(LocationServiceMap.Service))
        return Array.from(yield* RcMap.keys(locations.rcMap))
      }),
    )
    .handle(
      "debug.location.evict",
      Effect.fn(function* (ctx) {
        const locations = Option.getOrThrow(yield* Effect.serviceOption(LocationServiceMap.Service))
        // Resolve through requestRef so the key matches the shape the location
        // middleware cached the services under.
        yield* locations.invalidate(requestRef(ctx.request))
      }),
    ),
)
