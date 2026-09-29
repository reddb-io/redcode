import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const ModelHandler = HttpApiBuilder.group(Api, "server.model", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "model.list",
        Effect.fn(function* () {
          const models = yield* Model.Service
          return yield* response(models.available())
        }),
      )
      .handle(
        "model.default",
        Effect.fn(function* () {
          // Provider plugins activate in the background; before they settle an empty catalog would read
          // as "no provider connected" to a caller that just started this server.
          yield* Plugin.awaitActivation
          const models = yield* Model.Service
          return yield* response(models.default())
        }),
      )
  }),
)
