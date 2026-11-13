import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, UnauthorizedError } from "../errors.js"
import { ConsoleForbiddenError } from "../console.js"
import { RemoteAccess } from "@opencode/schema/remote-access"
import { Attention } from "@opencode/schema/attention"
import { HostResources } from "@opencode/schema/host-resources"
import { Memory } from "@opencode/schema/memory"
import { ClientPresence } from "@opencode/schema/client-presence"
import { ModelPerformance } from "@opencode/schema/model-performance"
import { ServerCapabilities } from "@opencode/schema/server-capabilities"
import { optional } from "@opencode/schema/schema"

export const ServerInfo = Schema.Struct({
  capabilities: ServerCapabilities.Info.pipe(optional),
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
  /** Memory of this server's runtime, not the client making the diagnostic request. */
  processMemory: Schema.optionalKey(
    Schema.Struct({
      heapUsed: Schema.Finite,
      heapTotal: Schema.Finite,
      external: Schema.Finite,
      arrayBuffers: Schema.Finite,
    }),
  ),
  /** Counts only; reading this snapshot never starts a project runtime or an execution. */
  activity: Schema.optionalKey(
    Schema.Struct({
      cachedLocations: Schema.Int,
      activeExecutions: Schema.Int,
      eventFeed: Schema.optionalKey(
        Schema.Struct({
          subscribers: Schema.Int,
          queuedBytes: Schema.Int,
          peakQueuedBytes: Schema.Int,
          frames: Schema.Int,
          encodedBytes: Schema.Int,
          largestFrameBytes: Schema.Int,
          frameBytesP50: Schema.Int,
          frameBytesP95: Schema.Int,
          frameBytesP99: Schema.Int,
          overflows: Schema.Int,
          acknowledgements: Schema.optionalKey(Schema.Int),
          replayedFrames: Schema.optionalKey(Schema.Int),
          replayMisses: Schema.optionalKey(Schema.Int),
          retainedFrames: Schema.optionalKey(Schema.Int),
          retainedBytes: Schema.optionalKey(Schema.Int),
          cursor: Schema.optionalKey(Schema.Int),
          oldestCursor: Schema.optionalKey(Schema.Int),
          acknowledgedClients: Schema.optionalKey(Schema.Int),
          maxAcknowledgementLag: Schema.optionalKey(Schema.Int),
        }),
      ),
    }),
  ),
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
  /** Live clients with an open event stream, de-duplicated by client identity. */
  clients: Schema.optionalKey(ClientPresence.Snapshot),
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
    HttpApiEndpoint.get("server.remoteAccess", "/api/remote-access", {
      success: RemoteAccess.Status,
      error: [InvalidRequestError, ConsoleForbiddenError],
    }),
  )
  .add(
    HttpApiEndpoint.post("server.configureRemoteAccess", "/api/remote-access", {
      payload: RemoteAccess.Configure,
      success: RemoteAccess.Status,
      error: [InvalidRequestError, ConsoleForbiddenError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("server.disableRemoteAccess", "/api/remote-access", {
      success: RemoteAccess.Status,
      error: [InvalidRequestError, ConsoleForbiddenError],
    }),
  )
  .add(
    HttpApiEndpoint.get("server.memory", "/api/memory", {
      success: Memory.Snapshot,
      error: [ConsoleForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({ identifier: "server.memory", summary: "Sample owned execution memory on demand" }),
    ),
  )
  .add(
    HttpApiEndpoint.get("server.memoryCaptures", "/api/memory/captures", {
      success: Schema.Array(Memory.Capture),
      error: [ConsoleForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({ identifier: "server.memoryCaptures", summary: "List local diagnostic captures" }),
    ),
  )
  .add(
    HttpApiEndpoint.post("server.startMemoryCapture", "/api/memory/captures", {
      payload: Memory.CaptureStart,
      success: Memory.Capture,
      error: [InvalidRequestError, ConsoleForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({ identifier: "server.startMemoryCapture", summary: "Start a local diagnostic capture" }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("server.cancelMemoryCapture", "/api/memory/captures/:id/run", {
      params: { id: Memory.CaptureID },
      success: Memory.Capture,
      error: [InvalidRequestError, ConsoleForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({ identifier: "server.cancelMemoryCapture", summary: "Cancel a diagnostic capture" }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("server.deleteMemoryCapture", "/api/memory/captures/:id", {
      params: { id: Memory.CaptureID },
      success: HttpApiSchema.NoContent,
      error: [InvalidRequestError, ConsoleForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({ identifier: "server.deleteMemoryCapture", summary: "Delete a local diagnostic capture" }),
    ),
  )
  .add(
    HttpApiEndpoint.get("server.downloadMemoryCapture", "/api/memory/captures/:id/download", {
      params: { id: Memory.CaptureID },
      success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
      error: [InvalidRequestError, ConsoleForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({ identifier: "server.downloadMemoryCapture", summary: "Download a diagnostic capture" }),
    ),
  )
  .add(
    HttpApiEndpoint.get("server.resources", "/api/resources", {
      success: HostResources.Snapshot,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.resources",
        summary: "Sample host resources",
        description:
          "Read CPU and memory on demand. The first CPU sample is unknown; no background collector is started.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("server.attention", "/api/attention", {
      success: Attention.Snapshot,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.attention",
        summary: "Read pending Session requests",
        description:
          "Inspect only cached Locations for pending permissions and forms. No transcript or new Location is loaded.",
      }),
    ),
  )
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
    HttpApiEndpoint.get("server.performance", "/api/performance", {
      success: ModelPerformance.Snapshot,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.performance",
        summary: "Get model performance",
        description:
          "Summarize time to first output, generation throughput, and failures from up to 5,000 persisted model responses in the last 24 hours.",
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
