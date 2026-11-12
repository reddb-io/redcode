import { CreatorPlugins } from "@opencode/core/creator/plugin"
import type { Design } from "@opencode/schema/design"
import {
  ConflictError,
  CreatorPluginNotFoundError,
  InvalidRequestError,
  ServiceUnavailableError,
} from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const CreatorPluginHandler = HttpApiBuilder.group(Api, "server.creatorPlugin", (handlers) =>
  handlers
    .handle("creator.plugin.list", () => CreatorPlugins.Service.use((service) => response(errors(service.list()))))
    .handle("creator.plugin.candidates", () =>
      CreatorPlugins.Service.use((service) => response(errors(service.candidates()))),
    )
    .handle("creator.plugin.review", (ctx) =>
      CreatorPlugins.Service.use((service) => response(errors(service.review(ctx.payload)))),
    )
    .handle("creator.plugin.install", (ctx) =>
      CreatorPlugins.Service.use((service) => response(errors(service.install(ctx.payload)))),
    )
    .handle("creator.plugin.test", (ctx) =>
      CreatorPlugins.Service.use((service) => response(errors(service.test(ctx.params.pluginID, ctx.payload)))),
    )
    .handle("creator.plugin.control", (ctx) =>
      CreatorPlugins.Service.use((service) => response(errors(service.control(ctx.params.pluginID, ctx.payload)))),
    )
    .handle("creator.plugin.remove", (ctx) =>
      CreatorPlugins.Service.use((service) =>
        errors(service.remove(ctx.params.pluginID, ctx.payload)).pipe(Effect.as(HttpApiSchema.NoContent.make())),
      ),
    ),
)

function errors<A, R>(effect: Effect.Effect<A, CreatorPlugins.Error | Design.Error, R>) {
  return effect.pipe(
    Effect.mapError((error) => {
      if (error.code === "not-found") return new CreatorPluginNotFoundError({ message: error.message })
      if (error.code === "unavailable")
        return new ServiceUnavailableError({ message: error.message, service: "creator.plugin" })
      if (error.code === "conflict") return new ConflictError({ message: error.message, resource: "creator.plugin" })
      return new InvalidRequestError({ message: error.message, kind: "creator.plugin" })
    }),
  )
}
