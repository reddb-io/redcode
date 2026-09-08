export * as DesignReviewServer from "./review-server"

import { Context, Effect, Layer, Scope } from "effect"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"

export class Service extends Context.Service<Service, { readonly url: Effect.Effect<string> }>()(
  "@redcode/DesignReviewServer",
) {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const scope = yield* Scope.Scope
    const url = yield* Effect.cached(
      Effect.acquireRelease(
        Effect.promise(async () => {
          const { Server } = await import("@/server/server")
          if (Server.url) return { url: Server.url.toString(), owned: undefined }
          const owned = await Server.listen({ hostname: "127.0.0.1", port: 0 })
          return { url: owned.url.toString(), owned }
        }),
        (server) => (server.owned ? Effect.promise(() => server.owned!.stop(true)) : Effect.void),
      ).pipe(
        Effect.map((server) => server.url),
        Effect.provideService(Scope.Scope, scope),
      ),
    )
    return { url }
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })
