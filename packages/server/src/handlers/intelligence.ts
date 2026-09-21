import { Semantic } from "@reddb-io/redcode-core/semantic"
import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { InvalidRequestError } from "@reddb-io/redcode-protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

const checked = <A, R>(effect: Effect.Effect<A, Intelligence.Error, R>) =>
  effect.pipe(Effect.mapError((error) => new InvalidRequestError({ message: error.message, kind: "intelligence" })))
export const IntelligenceHandler = HttpApiBuilder.group(Api, "server.intelligence", (handlers) =>
  handlers
    .handle("intelligence.get", () =>
      Effect.gen(function* () {
        const service = yield* Intelligence.Service
        return {
          settings: yield* checked(service.read()),
          environment: service.environment,
          evaluators: yield* checked(service.options()),
        }
      }),
    )
    .handle("intelligence.save", (ctx) =>
      Effect.gen(function* () {
        const service = yield* Intelligence.Service
        return yield* checked(service.save(ctx.payload))
      }),
    )
    .handle("intelligence.discover", (ctx) =>
      Effect.gen(function* () {
        const service = yield* Intelligence.Service
        return yield* checked(service.discover(ctx.payload))
      }),
    )
    .handle("intelligence.probe", (ctx) =>
      Effect.gen(function* () {
        const service = yield* Intelligence.Service
        return yield* checked(service.probe(ctx.payload))
      }),
    )
    .handle("intelligence.history", (ctx) =>
      Effect.gen(function* () {
        const service = yield* Intelligence.Service
        return yield* checked(service.history(ctx.query.sessionID ?? "", ctx.query))
      }),
    ),
)

export const IntelligenceModelHandler = HttpApiBuilder.group(Api, "server.intelligence.model", (handlers) =>
  handlers.handle("intelligence.model.test", (ctx) =>
    Effect.gen(function* () {
      const service = yield* Semantic.Service
      return yield* service.probeModel(ctx.payload)
    }),
  ),
)
