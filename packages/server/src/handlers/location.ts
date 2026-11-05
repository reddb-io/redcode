import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { ServiceUnavailableError } from "@opencode/protocol/errors"
import { Cause, Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const LocationHandler = HttpApiBuilder.group(Api, "server.location", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    return handlers
      .handle(
        "location.get",
        Effect.fn(function* () {
          const location = yield* Location.Service
          return new Location.Info({
            directory: location.directory,
            project: location.project,
          })
        }),
      )
      .handle("location.bootstrap", () =>
        Effect.gen(function* () {
          yield* Plugin.awaitActivation
          const models = yield* Model.Service
          const providers = yield* Provider.Service
          const integrations = yield* Integration.Service
          return yield* response(
            Effect.all(
              {
                models: models.available(),
                providers: providers.available(),
                integrations: integrations.list(),
              },
              { concurrency: "unbounded" },
            ),
          )
        }),
      )
      .handle("location.reload", () =>
        LocationServiceMap.reload().pipe(
          Effect.provideService(LocationServiceMap.Service, locations),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)))
              : Effect.fail(new ServiceUnavailableError({ message: Cause.pretty(cause), service: "location" })),
          ),
        ),
      )
  }),
)
