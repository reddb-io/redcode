import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Design } from "@reddb-io/redcode-schema/design"
import { Session } from "@reddb-io/redcode-schema/session"
import { NonNegativeInt } from "@reddb-io/redcode-schema/schema"
import { ForbiddenError } from "../errors"

const root = "/api/session/:sessionID/design"
const item = `${root}/:designID`
const params = { sessionID: Session.ID, designID: Design.ID }
const error = Design.Error.annotate({ identifier: "DesignError" }).pipe(HttpApiSchema.status(409))

export const makeDesignGroup = <Id extends HttpApiMiddleware.AnyId, Service>(middleware: Context.Key<Id, Service>) =>
  HttpApiGroup.make("server.design")
    .add(
      HttpApiEndpoint.get("design.review", `${root}/review`, {
        params: { sessionID: Session.ID },
        success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
        error,
      }),
    )
    .add(
      HttpApiEndpoint.get("design.whiteboard", `${root}/whiteboard`, {
        params: { sessionID: Session.ID },
        success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
        error,
      }),
    )
    .add(
      HttpApiEndpoint.get("design.feed", `${root}/feed`, {
        params: { sessionID: Session.ID },
        query: { after: Schema.NumberFromString.pipe(Schema.decodeTo(NonNegativeInt), Schema.optional) },
        success: HttpApiSchema.StreamSse({ data: Design.FeedEvent }),
        error,
      }).annotateMerge(
        OpenApi.annotations({
          summary: "Subscribe to the design conversation feed",
          description:
            "Replay the session's conversation as reduced feed entries after an exclusive sequence, then continue live: agent replies, tool calls, published revisions, agent switches and working state.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("design.list", root, {
        params: { sessionID: Session.ID },
        success: Schema.Array(Design.Info),
        error,
      }),
    )
    .add(
      HttpApiEndpoint.post("design.create", root, {
        params: { sessionID: Session.ID },
        payload: Design.Create,
        success: Design.Info,
        error,
      }),
    )
    .add(HttpApiEndpoint.get("design.get", item, { params, success: Design.Info, error }))
    .add(HttpApiEndpoint.patch("design.update", item, { params, payload: Design.Update, success: Design.Info, error }))
    .add(
      HttpApiEndpoint.get("design.revisions", `${item}/revision`, {
        params,
        success: Schema.Array(Design.Revision),
        error,
      }),
    )
    .add(
      HttpApiEndpoint.get("design.preview", `${item}/revision/:revisionID/preview`, {
        params: { ...params, revisionID: Schema.String },
        success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
        error,
      }),
    )
    .add(
      HttpApiEndpoint.get("design.present", `${item}/present`, {
        params,
        query: {
          view: Schema.Literals(["audience", "presenter"]).pipe(Schema.optional),
          revision: Schema.String.pipe(Schema.optional),
        },
        success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
        error,
      }).annotateMerge(
        OpenApi.annotations({
          summary: "Present a deck",
          description:
            "An HTML page that presents a presentation design's latest revision, or the given one: the audience view shows the slide full screen; the presenter view shows the current and next slide, the speaker notes and a timer. Windows of the same design stay on the same slide.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("design.publish", `${item}/revision`, {
        params,
        payload: Schema.Struct({ name: Schema.String }),
        success: Design.Revision,
        error,
      }),
    )
    .add(
      HttpApiEndpoint.post("design.restore", `${item}/restore`, {
        params,
        payload: Schema.Struct({ revision: Schema.String }),
        success: Design.Revision,
        error,
      }),
    )
    .add(HttpApiEndpoint.post("design.reopen", `${item}/reopen`, { params, success: Design.Info, error }))
    .add(HttpApiEndpoint.post("design.refresh", `${item}/refresh`, { params, success: Design.Info, error }))
    .add(
      HttpApiEndpoint.post("design.feedback", `${item}/feedback`, {
        params,
        payload: Design.Feedback,
        success: Design.Receipt,
        error,
      }),
    )
    .add(
      HttpApiEndpoint.post("design.approve", `${item}/approve`, {
        params,
        payload: Design.Approve,
        success: Schema.Struct({ plan: Schema.String, revision: Schema.String }),
        error,
      }),
    )
    .add(
      HttpApiEndpoint.get("design.approval", `${item}/approval/:revisionID`, {
        params: { ...params, revisionID: Schema.String },
        success: Design.Approval,
        error,
      }),
    )
    .add(HttpApiEndpoint.get("design.assets", `${item}/asset`, { params, success: Schema.Array(Design.Asset), error }))
    .add(
      HttpApiEndpoint.post("design.importAsset", `${item}/asset`, {
        params,
        payload: Design.ImportAsset,
        success: Design.Asset,
        error,
      }),
    )
    .add(HttpApiEndpoint.get("design.jobs", `${item}/job`, { params, success: Schema.Array(Design.Job), error }))
    .add(
      HttpApiEndpoint.post("design.render", `${item}/job`, {
        params,
        payload: Design.Render,
        success: Design.Job,
        error,
      }),
    )
    .add(
      HttpApiEndpoint.post("design.cancel", `${item}/job/:jobID/cancel`, {
        params: { ...params, jobID: Schema.String },
        success: Design.Job,
        error,
      }),
    )
    .add(
      HttpApiEndpoint.get("design.download", `${item}/job/:jobID/file`, {
        params: { ...params, jobID: Schema.String },
        success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
        error,
      }),
    )
    .add(
      HttpApiEndpoint.get("design.assetFile", `${item}/asset/:assetID/file`, {
        params: { ...params, assetID: Schema.String },
        success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
        error,
      }),
    )
    .middleware(middleware)
    .annotateMerge(
      OpenApi.annotations({
        title: "Design",
        description: "Design documents, immutable revisions, review, assets and local exports.",
      }),
    )

const host = "/api/design/session/:sessionID"
const hostParams = { sessionID: Session.ID }
const hostItemParams = { sessionID: Session.ID, designID: Design.ID }

export const DesignHostReview = Schema.Struct({
  url: Schema.String,
  /** Review pages following this session's feed in the serving process. */
  connected: Schema.Number,
}).annotate({ identifier: "DesignHostReview" })

export const DesignHostLaunch = Schema.Struct({
  url: Schema.String,
  outcome: Schema.Literals(["claimed", "connected", "pending"]),
  /** Present on a claim; give it back through the release route when the launch fails. */
  token: Schema.optional(Schema.Number),
}).annotate({ identifier: "DesignHostLaunch" })

export const DesignHostPermission = Schema.Struct({
  permission: Schema.String,
  patterns: Schema.Array(Schema.String),
  always: Schema.optional(Schema.Array(Schema.String)),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "DesignHostPermission" })

/**
 * The session side of Design: what a design surface (the review page, the TUI, `redcode design`, a
 * separate design process) asks of the process that runs the conversation. Documents, revisions and
 * exports stay in `server.design`; these routes reach the conversation runtime, its bus and its
 * permission queue, which only the owning process has.
 */
export const makeDesignHostGroup = <Id extends HttpApiMiddleware.AnyId, Service>(
  sessionMiddleware: Context.Key<Id, Service>,
) =>
  HttpApiGroup.make("design.host")
    .add(
      HttpApiEndpoint.get("designHost.list", "/api/design/list", {
        query: { directory: Schema.String },
        success: Schema.Array(Design.Conversation),
        error: ForbiddenError,
      }).annotateMerge(
        OpenApi.annotations({
          summary: "List Design conversations",
          description: "Conversations of a directory that own a design or run in Design mode, newest first.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("designHost.open", `${host}/open`, {
        params: hostParams,
        success: DesignHostReview,
        error: [error, ForbiddenError],
      }).middleware(sessionMiddleware),
    )
    .add(
      HttpApiEndpoint.post("designHost.launch", `${host}/launch`, {
        params: hostParams,
        payload: Schema.Struct({ explicit: Schema.optional(Schema.Boolean) }),
        success: DesignHostLaunch,
        error: [error, ForbiddenError],
      })
        .middleware(sessionMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            summary: "Claim a review browser launch",
            description:
              "Claims opening a browser tab on the session's review, against the review pages connected to its feed. Never while a page is connected and never twice within the debounce.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("designHost.release", `${host}/launch/release`, {
        params: hostParams,
        payload: Schema.Struct({ token: Schema.Number }),
        error: [error, ForbiddenError],
      }).middleware(sessionMiddleware),
    )
    .add(
      HttpApiEndpoint.get("designHost.feed", `${host}/feed`, {
        params: hostParams,
        query: { after: Schema.NumberFromString.pipe(Schema.decodeTo(NonNegativeInt), Schema.optional) },
        success: HttpApiSchema.StreamSse({ data: Design.FeedEvent }),
        error: [error, ForbiddenError],
      })
        .middleware(sessionMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            summary: "Subscribe to the conversation feed",
            description:
              "The conversation as reduced feed entries, replayed then live. A subscriber counts as a connected review page.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("designHost.feedback", `${host}/:designID/feedback`, {
        params: hostItemParams,
        payload: Design.Feedback,
        success: Design.Receipt,
        error: [error, ForbiddenError],
      })
        .middleware(sessionMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            summary: "Admit review feedback",
            description:
              "Admits feedback into the conversation. Idempotent by feedback ID: an exact retry returns the same receipt.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("designHost.approve", `${host}/:designID/approve`, {
        params: hostItemParams,
        payload: Design.Approve,
        success: Schema.Struct({ plan: Schema.String, revision: Schema.String }),
        error: [error, ForbiddenError],
      })
        .middleware(sessionMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            summary: "Approve a revision and hand off to the plan",
            description:
              "Records the approval, writes the Design section of the session plan and continues the conversation in Plan mode.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("designHost.permission", `${host}/permission`, {
        params: hostParams,
        payload: DesignHostPermission,
        success: Schema.Struct({ granted: Schema.Boolean }),
        error: [error, ForbiddenError],
      })
        .middleware(sessionMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            summary: "Ask a permission for the session",
            description:
              "Asks through the session's permission queue with its agent's rules; waits for the user when a rule asks. A refusal answers granted false.",
          }),
        ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "Design host",
        description:
          "Session-side Design contract: conversation list, review launches, feed, feedback, approval and permissions.",
      }),
    )
