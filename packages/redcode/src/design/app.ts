export * as DesignAppClient from "./app"

import { Effect, Option, Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { DesignApp } from "@reddb-io/redcode-core/design/app"
import { Database } from "@reddb-io/redcode-core/database/database"
import { ServerAuth } from "@reddb-io/redcode-server/auth"

/**
 * redcode's side of the design app: with `design.app.mode` "process", builds, renders and exports run
 * in `redcode-design` and the review links point at it, while the conversation stays here behind
 * `design.host`. Documents are still read and written directly through the Design store.
 */

export interface Connection {
  readonly url: string
  readonly token: string
  /** This redcode's server, where the app reaches `design.host`. */
  readonly host: string
}

/**
 * The design app to use, started when none runs; nothing when Design runs inline, which is the default
 * and what a compiled redcode without `REDCODE_DESIGN_BIN` falls back to.
 */
export const connect = Effect.fn("DesignAppClient.connect")(function* (
  mode: "process" | "inline" | undefined,
  server: Effect.Effect<string>,
) {
  if (mode !== "process") return undefined
  const command = DesignApp.command()
  if (!command) {
    yield* Effect.logWarning("design.app.mode is process but the design app is unavailable; Design runs inline")
    return undefined
  }
  const host = loopback(yield* server)
  const started = yield* Effect.tryPromise({
    // The app opens this redcode's database file, whatever its release channel names it.
    try: () => DesignApp.ensure({ host, command, env: { REDCODE_DB: Database.path() } }),
    catch: (cause) =>
      new Design.Error({
        code: "unavailable",
        message: `The design app did not start: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  })
  return { ...started, host } satisfies Connection
})

/** The session's review page on the app, with a ticket that lets the browser in. */
export const review = Effect.fn("DesignAppClient.review")(function* (connection: Connection, sessionID: string) {
  // Tells the app which redcode serves this session before a browser asks it for the feed.
  yield* send(connection, sessionID, "/attach", { method: "POST" })
  const url = new URL(`/design/session/${encodeURIComponent(sessionID)}/review`, connection.url)
  url.searchParams.set("ticket", DesignApp.ticket(connection.token, sessionID))
  return url.toString()
})

export const publish = (
  connection: Connection,
  sessionID: string,
  id: Design.ID,
  input: { readonly name: string; readonly tooling: boolean },
) => call(connection, sessionID, `/${id}/revision`, Design.Revision, { method: "POST", body: input })

export const restore = (
  connection: Connection,
  sessionID: string,
  id: Design.ID,
  input: { readonly revision: string; readonly tooling: boolean },
) => call(connection, sessionID, `/${id}/restore`, Design.Revision, { method: "POST", body: input })

export const render = (connection: Connection, sessionID: string, id: Design.ID, input: Design.Render) =>
  call(connection, sessionID, `/${id}/job`, Design.Job, { method: "POST", body: input })

export const jobs = (connection: Connection, sessionID: string, id: Design.ID) =>
  call(connection, sessionID, `/${id}/job`, Schema.Array(Design.Job))

export const cancel = (connection: Connection, sessionID: string, id: Design.ID, jobID: string) =>
  call(connection, sessionID, `/${id}/job/${encodeURIComponent(jobID)}/cancel`, Design.Job, { method: "POST" })

const call = <A>(
  connection: Connection,
  sessionID: string,
  route: string,
  schema: Schema.Codec<A, unknown, never, never>,
  init: { readonly method?: string; readonly body?: unknown } = {},
) =>
  send(connection, sessionID, route, init).pipe(
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.json(),
        catch: () =>
          new Design.Error({ code: "unavailable", message: `The design app answered ${response.status} without JSON` }),
      }).pipe(Effect.flatMap((payload) => (response.ok ? decode(schema, payload) : Effect.fail(failure(payload))))),
    ),
  )

const send = (
  connection: Connection,
  sessionID: string,
  route: string,
  init: { readonly method?: string; readonly body?: unknown },
) => {
  const authorization = ServerAuth.header()
  return Effect.tryPromise({
    try: (signal) =>
      fetch(new URL(`/design/session/${encodeURIComponent(sessionID)}${route}`, connection.url), {
        method: init.method ?? "GET",
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal,
        headers: {
          authorization: `Bearer ${connection.token}`,
          [DesignApp.HOST_HEADER]: connection.host,
          ...(authorization ? { [DesignApp.HOST_AUTHORIZATION_HEADER]: authorization } : {}),
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
      }),
    catch: (cause) =>
      new Design.Error({
        code: "unavailable",
        message: `The design app did not answer: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  })
}

const decode = <A>(schema: Schema.Codec<A, unknown, never, never>, payload: unknown) =>
  Schema.decodeUnknownEffect(schema)(payload).pipe(
    Effect.mapError(
      (error) => new Design.Error({ code: "unavailable", message: `The design app answered: ${error.message}` }),
    ),
  )

const Failure = Schema.Struct({
  code: Schema.Literals(["not-found", "conflict", "invalid", "unavailable"]),
  message: Schema.String,
})

function failure(payload: unknown) {
  const decoded = Schema.decodeUnknownOption(Failure)(payload)
  if (Option.isSome(decoded)) return new Design.Error(decoded.value)
  return new Design.Error({ code: "unavailable", message: "The design app failed without saying why" })
}

/** A server bound to every interface is reached on loopback. */
function loopback(url: string) {
  const parsed = new URL(url)
  if (parsed.hostname === "0.0.0.0" || parsed.hostname === "[::]" || parsed.hostname === "::")
    parsed.hostname = "127.0.0.1"
  return parsed.origin
}
