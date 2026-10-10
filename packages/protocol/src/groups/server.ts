import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { UnauthorizedError } from "../errors.js"

export const ServerInfo = Schema.Struct({
  version: Schema.String,
  // 0 means the runtime has no OS process identity (e.g. workerd).
  pid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  urls: Schema.Array(Schema.String),
  paths: Schema.Struct({
    tmp: Schema.String,
  }),
}).annotate({ identifier: "ServerInfo" })
export type ServerInfo = typeof ServerInfo.Type

/**
 * What the running Redcode server is, for a System view: its version and runtime, where its data lives and how big it
 * is, and which database it talks to. Never a credential: a remote database is named by its host only.
 */
export const SystemInfo = Schema.Struct({
  version: Schema.String,
  /** The runtime and its version, such as `bun 1.4.2`. */
  runtime: Schema.String,
  /** The operating system and architecture, such as `linux x64`. */
  platform: Schema.String,
  pid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** When the server started, in epoch milliseconds. */
  started: Schema.Finite,
  /** The server process's resident memory in bytes. */
  memory: Schema.Finite,
  urls: Schema.Array(Schema.String),
  paths: Schema.Struct({
    config: Schema.String,
    data: Schema.String,
    state: Schema.String,
    cache: Schema.String,
    log: Schema.String,
    tmp: Schema.String,
  }),
  database: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("local"),
      path: Schema.String,
      /** The database file's size in bytes, when it could be read. */
      size: Schema.optionalKey(Schema.Finite),
      /** The write-ahead log's size in bytes, when there is one. */
      wal: Schema.optionalKey(Schema.Finite),
    }),
    Schema.Struct({ kind: Schema.Literal("remote"), protocol: Schema.String, host: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("memory") }),
  ]),
  /** Rows stored, when the database could be counted. */
  counts: Schema.optionalKey(Schema.Struct({ sessions: Schema.Finite, messages: Schema.Finite })),
}).annotate({ identifier: "SystemInfo" })
export type SystemInfo = typeof SystemInfo.Type

export const PairingCode = Schema.Struct({
  code: Schema.String,
  expires_in: Schema.Int,
}).annotate({ identifier: "PairingCode" })
export type PairingCode = typeof PairingCode.Type

export const PairingSession = Schema.Struct({
  token: Schema.String,
}).annotate({ identifier: "PairingSession" })
export type PairingSession = typeof PairingSession.Type

const PAIRING_CONNECT_PATH = /^\/auth\/connect\/[^/]+$/

// Authorization middleware skips credential checks for pairing links; the connect handler consumes the code instead.
export function isPairingConnectURL(url: URL) {
  return PAIRING_CONNECT_PATH.test(url.pathname)
}

export const ServerGroup = HttpApiGroup.make("server.server")
  .add(
    HttpApiEndpoint.get("server.info", "/api/info", {
      success: ServerInfo,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.info",
        summary: "Get server info",
        description: "Return the server identity, connection URLs, paths, and readiness status.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("server.system", "/api/system", {
      success: SystemInfo,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.system",
        summary: "Get system info",
        description:
          "Return the server's version, runtime, data paths, database (local size or remote host) and memory. Never a credential.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("server.pair", "/api/pair", {
      success: PairingCode,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.pair",
        summary: "Create pairing code",
        description: "Create a short-lived, single-use code for a /auth/connect/:code pairing link.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("server.cancelPair", "/api/pair/:code", {
      params: { code: Schema.String },
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.cancelPair",
        summary: "Cancel pairing code",
        description: "Invalidate an unused pairing link. Already paired sessions remain connected.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("server.connect", "/auth/connect/:code", {
      params: { code: Schema.String },
      success: PairingSession,
      error: UnauthorizedError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.connect",
        summary: "Redeem pairing code",
        description:
          "Redeem a pairing code. Browsers receive a session cookie and a redirect to the web app; requests that accept JSON receive a session token to use as the password.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "server" }))
