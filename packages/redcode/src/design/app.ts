export * as DesignAppClient from "./app"

import { Effect } from "effect"
import { HttpServerResponse, type HttpServerRequest } from "effect/unstable/http"
import { DesignApp } from "@reddb-io/redcode-core/design/app"
import { DesignAppBinary } from "@reddb-io/redcode-core/design/app-binary"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { TuiEvent } from "@/server/tui-event"
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
 * A first-use download shows its progress in the TUI through `events`.
 */
export const connect = Effect.fn("DesignAppClient.connect")(function* (
  design: { readonly mode?: "process" | "inline"; readonly version?: string } | undefined,
  server: Effect.Effect<string>,
  events?: EventV2.Interface,
) {
  const only = process.env.REDCODE_DESIGN_APP_ONLY === "1"
  if (!only && design?.mode !== "process") return undefined
  const toast = Effect.runForkWith(yield* Effect.context())
  const stop = DesignAppBinary.watch((progress) => {
    const shown = status(progress)
    if (events && shown) toast(events.publish(TuiEvent.ToastShow, shown).pipe(Effect.ignore))
  })
  const connecting = DesignApp.connect({
    host: { url: DesignApp.loopback(yield* server), authorization: ServerAuth.header() },
    version: design?.version,
  }).pipe(Effect.ensuring(Effect.sync(stop)))
  if (only) return yield* connecting
  return yield* connecting.pipe(
    Effect.catch((error) =>
      Effect.logWarning(`design.app.mode is process but ${error.message}; Design runs inline`).pipe(
        Effect.as(undefined),
      ),
    ),
  )
})

/** The TUI status of a design app download, such as "Downloading redcode-design 0.1.0… 45%"; none otherwise. */
export function status(progress: DesignAppBinary.Progress | undefined) {
  if (progress?.phase !== "download") return undefined
  return { message: DesignAppBinary.describe(progress), variant: "info" as const, duration: 8_000 }
}

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
    // While the app downloads or starts, the browser waits on a page that follows it, not a connection error.
    const opened = yield* DesignApp.open({
      host: { url: `http://${request.headers.host}`, authorization: ServerAuth.header() },
      sessionID: parts[2],
      route,
      search: Object.fromEntries(url.searchParams),
    })
    if ("redirect" in opened) return HttpServerResponse.redirect(opened.redirect)
    return HttpServerResponse.text(opened.html, {
      status: opened.status,
      contentType: "text/html",
      headers: opened.headers,
    })
  })
