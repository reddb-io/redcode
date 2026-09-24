export * as DesignAppClient from "./app"

import { Effect } from "effect"
import { HttpServerResponse, type HttpServerRequest } from "effect/unstable/http"
import { DesignApp } from "@reddb-io/redcode-core/design/app"
import { DesignHost } from "@reddb-io/redcode-core/design/host"
import { ServerAuth } from "@reddb-io/redcode-server/auth"

/**
 * redcode's side of the design app (`redcode-design`), which builds, renders, exports and serves the
 * review while the conversation stays here behind `design.host`. A compiled redcode always runs Design
 * there; from source, `design.app.mode` "process" does and inline stays the default. Documents are
 * still read and written directly through the Design store.
 */

/**
 * The design app to use, started when none runs; nothing when Design runs inline. A compiled redcode
 * has no inline Design, so a failure to start the app is its error; from source it falls back to inline.
 */
export const connect = Effect.fn("DesignAppClient.connect")(function* (
  design: { readonly mode?: "process" | "inline"; readonly version?: string } | undefined,
  server: Effect.Effect<string>,
) {
  const only = process.env.REDCODE_DESIGN_APP_ONLY === "1"
  if (!only && design?.mode !== "process") return undefined
  const connecting = DesignApp.connect({
    host: { url: DesignApp.loopback(yield* server), authorization: ServerAuth.header() },
    version: design?.version,
  })
  if (only) return yield* connecting
  return yield* connecting.pipe(
    Effect.catch((error) =>
      Effect.logWarning(`design.app.mode is process but ${error.message}; Design runs inline`).pipe(
        Effect.as(undefined),
      ),
    ),
  )
})

/**
 * A review or presenter link to this server, from a compiled redcode that no longer serves the pages:
 * the browser goes on to the same page on the design app.
 */
export const redirect = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const url = new URL(request.url, "http://localhost")
    const parts = url.pathname.split("/").filter(Boolean)
    const route = `/${parts.slice(3).join("/")}`
    if (!DesignHost.allowed(request.headers.host)) return HttpServerResponse.empty({ status: 403 })
    if (
      request.method !== "GET" ||
      parts[1] !== "session" ||
      !parts[2] ||
      (route !== "/review" && !/^\/[^/]+\/present$/.test(route))
    )
      return HttpServerResponse.jsonUnsafe(
        { code: "not-found", message: "The design app serves Design; open the review again from redcode" },
        { status: 404 },
      )
    const connection = yield* DesignApp.connect({
      host: { url: `http://${request.headers.host}`, authorization: ServerAuth.header() },
    })
    return HttpServerResponse.redirect(
      yield* DesignApp.link(connection, parts[2], route, Object.fromEntries(url.searchParams)),
    )
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(HttpServerResponse.jsonUnsafe({ code: error.code, message: error.message }, { status: 503 })),
    ),
  )
