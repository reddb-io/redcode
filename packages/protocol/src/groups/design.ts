import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Design } from "@reddb-io/redcode-schema/design"
import { Session } from "@reddb-io/redcode-schema/session"

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
        payload: Schema.Struct({ revision: Schema.String }),
        success: Schema.Struct({ plan: Schema.String, revision: Schema.String }),
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
