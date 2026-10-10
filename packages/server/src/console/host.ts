export * as ConsoleHost from "./host.js"

import { Console } from "@opencode/core/console"
import { ConsoleInfrastructure } from "@opencode/core/console/infrastructure"
import { ConsoleAuthentication } from "@opencode/core/console/authentication"
import { Database } from "@opencode/core/database/database"
import { ConsoleApi } from "@opencode/protocol/console"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer, ManagedRuntime, Scope } from "effect"
import { HttpEffect, HttpRouter, HttpServer, HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { ConsoleHandler } from "./handler.js"
import { ConsoleFederation } from "./federation.js"
import { page } from "./page.js"

export interface Options {
  readonly setupToken: string
  readonly database: Database.Options
  readonly directories?: Partial<Global.Interface>
  readonly federation?: ConsoleFederation.Options
}

export const create = Effect.fn("ConsoleHost.create")(function* (options: Options) {
  const routes = HttpApiBuilder.layer(ConsoleApi, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(ConsoleHandler),
    Layer.provide(ConsoleFederation.layer(options.federation)),
    Layer.provide(ConsoleAuthentication.layer),
    Layer.provide(Console.layer({ setupToken: options.setupToken, sso: !!options.federation })),
    Layer.provide(ConsoleInfrastructure.layer(options.setupToken)),
    Layer.provide(Database.layer(options.database)),
    Layer.provide(Global.layerWith(options.directories ?? {})),
    Layer.provideMerge(HttpRouter.layer),
    Layer.provide(HttpServer.layerServices),
  )
  const runtime = ManagedRuntime.make(routes)
  return yield* Effect.gen(function* () {
    const services = yield* runtime.contextEffect
    const handler = HttpEffect.toWebHandlerWith<never, HttpServerRequest.HttpServerRequest | Scope.Scope>(services)(
      Context.get(services, HttpRouter.HttpRouter).asHttpEffect(),
    )
    const fetch = async (request: Request) => {
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname === "/")
        return new Response(page, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        })
      const response = await handler(request)
      response.headers.set("cache-control", "no-store")
      response.headers.set("x-content-type-options", "nosniff")
      return response
    }
    return { fetch, close: () => runtime.dispose() }
  }).pipe(Effect.onError(() => runtime.disposeEffect))
})
