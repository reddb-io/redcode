import { CreatorComponents } from "@opencode/core/creator/component"
import type { Design } from "@opencode/schema/design"
import { ConflictError, CreatorComponentNotFoundError, InvalidRequestError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const CreatorComponentHandler = HttpApiBuilder.group(Api, "server.creatorComponent", (handlers) =>
  handlers
    .handle("creator.component.list", () =>
      CreatorComponents.Service.use((service) => response(errors(service.list()))),
    )
    .handle("creator.component.install", (ctx) =>
      CreatorComponents.Service.use((service) => response(errors(service.install(ctx.payload)))),
    )
    .handle("creator.component.update", (ctx) =>
      CreatorComponents.Service.use((service) => response(errors(service.update(ctx.params.componentID, ctx.payload)))),
    )
    .handle("creator.component.control", (ctx) =>
      CreatorComponents.Service.use((service) =>
        response(errors(service.control(ctx.params.componentID, ctx.payload))),
      ),
    )
    .handle("creator.component.remove", (ctx) =>
      CreatorComponents.Service.use((service) =>
        errors(service.remove(ctx.params.componentID, ctx.payload)).pipe(Effect.as(HttpApiSchema.NoContent.make())),
      ),
    )
    .handle("creator.component.preview", (ctx) =>
      CreatorComponents.Service.use((service) => response(errors(service.preview(ctx.params.componentID)))),
    ),
)

function errors<A, R>(effect: Effect.Effect<A, CreatorComponents.Error | Design.Error, R>) {
  return effect.pipe(
    Effect.mapError((error) => {
      if (error.code === "not-found") return new CreatorComponentNotFoundError({ message: error.message })
      if (error.code === "conflict") return new ConflictError({ message: error.message, resource: "creator.component" })
      return new InvalidRequestError({ message: error.message, kind: "creator.component" })
    }),
  )
}
