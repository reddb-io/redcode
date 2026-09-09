export * as Design from "./design"

import { Schema } from "effect"
import { Session } from "./session"
import { SessionMessage } from "./session-message"
import { optional } from "./schema"

export const ID = Schema.String.check(Schema.isPattern(/^design_[a-zA-Z0-9_-]+$/)).pipe(Schema.brand("Design.ID"))
export type ID = typeof ID.Type
export const Kind = Schema.Literals(["screen", "flow", "comparison", "deck"])
export const Journey = Schema.Literals(["new", "existing"])
export const Engine = Schema.Literals(["html", "react", "solid"])

export const Decision = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  revision: Schema.String.pipe(optional),
  feedback: Schema.String.pipe(optional),
}).annotate({ identifier: "Design.Decision" })
export interface Decision extends Schema.Schema.Type<typeof Decision> {}

export const Scenario = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  selector: Schema.String,
  state: Schema.Literals(["loading", "empty", "error", "populated", "edge"]),
  actions: Schema.Array(
    Schema.Struct({
      selector: Schema.String,
      action: Schema.Literals(["click", "fill", "press"]),
      value: Schema.String.pipe(optional),
    }),
  ),
  notApplicable: Schema.String.pipe(optional),
}).annotate({ identifier: "Design.Scenario" })
export interface Scenario extends Schema.Schema.Type<typeof Scenario> {}

export const Brief = Schema.Struct({
  objective: Schema.String,
  audience: Schema.String,
  content: Schema.String,
  constraints: Schema.String,
  references: Schema.Array(Schema.String),
}).annotate({ identifier: "Design.Brief" })
export interface Brief extends Schema.Schema.Type<typeof Brief> {}

export const Source = Schema.Struct({
  file: Schema.String,
  hash: Schema.String,
  observed: Schema.Number,
  authoritative: Schema.Boolean,
  excerpt: Schema.String,
})
export const Tweaks = Schema.Record(
  Schema.String.check(Schema.isPattern(/^--[a-zA-Z][a-zA-Z0-9-]*$/)),
  Schema.String.check(Schema.isPattern(/^[^;{}<>]*$/)),
)

export const Create = Schema.Struct({
  name: Schema.NonEmptyString,
  journey: Journey,
  engine: Engine,
  kind: Kind,
  application: Schema.String.pipe(optional),
}).annotate({ identifier: "Design.Create" })
export interface Create extends Schema.Schema.Type<typeof Create> {}

export const Update = Schema.Struct({
  name: Schema.NonEmptyString.pipe(optional),
  brief: Brief.pipe(optional),
  decisions: Schema.Array(Decision).pipe(optional),
  questions: Schema.Array(Schema.String).pipe(optional),
  scenarios: Schema.Array(Scenario).pipe(optional),
  designSystem: Schema.String.pipe(optional),
  entry: Schema.String.pipe(optional),
  tweaks: Tweaks.pipe(optional),
}).annotate({ identifier: "Design.Update" })
export interface Update extends Schema.Schema.Type<typeof Update> {}

export const Info = Schema.Struct({
  id: ID,
  sessionID: Session.ID,
  name: Schema.String,
  journey: Journey,
  engine: Engine,
  kind: Kind,
  root: Schema.String,
  application: Schema.String,
  entry: Schema.String,
  brief: Brief,
  decisions: Schema.Array(Decision),
  questions: Schema.Array(Schema.String),
  scenarios: Schema.Array(Scenario),
  designSystem: Schema.String,
  sources: Schema.Array(Source),
  tweaks: Tweaks,
  revision: Schema.NullOr(Schema.String),
  approvedRevision: Schema.NullOr(Schema.String),
  ended: Schema.Boolean,
  updated: Schema.Number,
}).annotate({ identifier: "Design.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Conversation = Schema.Struct({
  sessionID: Session.ID,
  title: Schema.String,
  updated: Schema.Number,
  designs: Schema.Array(
    Schema.Struct({
      id: ID,
      name: Schema.String,
      revision: Schema.NullOr(Schema.String),
      approvedRevision: Schema.NullOr(Schema.String),
      ended: Schema.Boolean,
    }),
  ),
})
export interface Conversation extends Schema.Schema.Type<typeof Conversation> {}

export const Revision = Schema.Struct({
  id: Schema.String,
  designID: ID,
  parent: Schema.NullOr(Schema.String),
  name: Schema.String,
  created: Schema.Number,
  files: Schema.Record(Schema.String, Schema.String),
  document: Info,
}).annotate({ identifier: "Design.Revision" })
export interface Revision extends Schema.Schema.Type<typeof Revision> {}

/** A user-selected direction within the immutable prototype snapshot. */
export const Variant = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,64}$/)),
  name: Schema.NonEmptyString.check(Schema.isMaxLength(100)),
}).annotate({ identifier: "Design.Variant" })
export interface Variant extends Schema.Schema.Type<typeof Variant> {}

export const Approve = Schema.Struct({
  revision: Schema.NonEmptyString,
  variant: Variant.pipe(optional),
}).annotate({ identifier: "Design.Approve" })
export interface Approve extends Schema.Schema.Type<typeof Approve> {}

export const ApprovalNotice = Schema.Struct({
  id: ID,
  name: Schema.String,
  revision: Schema.String,
  variant: Schema.NullOr(Variant),
}).annotate({ identifier: "Design.ApprovalNotice" })
export interface ApprovalNotice extends Schema.Schema.Type<typeof ApprovalNotice> {}

export const Feedback = Schema.Struct({
  id: SessionMessage.ID,
  revision: Schema.String,
  text: Schema.NonEmptyString,
  items: Schema.Array(Schema.Struct({ target: Schema.String, text: Schema.String })),
  assets: Schema.Array(Schema.String),
  snapshot: Schema.String,
  whiteboards: Schema.Array(Schema.Struct({ target: Schema.String, scene: Schema.Unknown })).pipe(optional),
  delivery: Schema.Literals(["steer", "queue"]),
  end: Schema.Boolean,
}).annotate({ identifier: "Design.Feedback" })
export interface Feedback extends Schema.Schema.Type<typeof Feedback> {}

export const Receipt = Schema.Struct({
  id: SessionMessage.ID,
  status: Schema.Literals(["pending", "admitted"]),
}).annotate({ identifier: "Design.Receipt" })
export interface Receipt extends Schema.Schema.Type<typeof Receipt> {}

export const Asset = Schema.Struct({
  id: Schema.String,
  designID: ID,
  name: Schema.String,
  mime: Schema.String,
  bytes: Schema.Number,
  hash: Schema.String,
  source: Schema.String,
  parent: Schema.NullOr(Schema.String),
  created: Schema.Number,
}).annotate({ identifier: "Design.Asset" })
export interface Asset extends Schema.Schema.Type<typeof Asset> {}

export const ImportAsset = Schema.Struct({
  name: Schema.NonEmptyString,
  mime: Schema.Literals(["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif"]),
  data: Schema.String,
  source: Schema.String,
  parent: Schema.String.pipe(optional),
}).annotate({ identifier: "Design.ImportAsset" })
export interface ImportAsset extends Schema.Schema.Type<typeof ImportAsset> {}

export const Render = Schema.Struct({
  revision: Schema.String,
  format: Schema.Literals(["html", "gif", "audit", "compare"]),
  implementation: Schema.String.pipe(optional),
  candidate: Schema.String.pipe(optional),
  asset: Schema.String.pipe(optional),
  duration: Schema.Number.check(Schema.isBetween({ minimum: 0.1, maximum: 10 })).pipe(optional),
  fps: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 25 })).pipe(optional),
  size: Schema.Int.check(Schema.isBetween({ minimum: 16, maximum: 1024 })).pipe(optional),
  repeat: Schema.Int.check(Schema.isGreaterThanOrEqualTo(-1)).pipe(optional),
  background: Schema.String.pipe(optional),
  transparent: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Design.Render" })
export interface Render extends Schema.Schema.Type<typeof Render> {}

export const Audit = Schema.Struct({
  revision: Schema.String,
  findings: Schema.Array(Schema.String),
  scenarios: Schema.Array(Schema.String),
  widths: Schema.Array(Schema.Number),
}).annotate({ identifier: "Design.Audit" })
export interface Audit extends Schema.Schema.Type<typeof Audit> {}

export const Job = Schema.Struct({
  id: Schema.String,
  designID: ID,
  input: Render,
  status: Schema.Literals(["queued", "running", "completed", "failed", "cancelled", "interrupted"]),
  progress: Schema.Number,
  result: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  created: Schema.Number,
  started: Schema.Number.pipe(optional),
  finished: Schema.Number.pipe(optional),
  audit: Audit.pipe(optional),
}).annotate({ identifier: "Design.Job" })
export interface Job extends Schema.Schema.Type<typeof Job> {}

/** Version 0 denotes a historical package without recorded selection or approval time. */
export const Approval = Schema.Struct({
  version: Schema.Literals([0, 1]),
  approvedAt: Schema.NullOr(Schema.Number),
  variant: Schema.NullOr(Variant),
  revision: Revision,
  assets: Schema.Array(Asset),
  feedback: Schema.Array(Feedback),
  audits: Schema.Array(Schema.Struct({ id: Schema.String, result: Schema.NullOr(Schema.String), audit: Audit })),
}).annotate({ identifier: "Design.Approval" })
export interface Approval extends Schema.Schema.Type<typeof Approval> {}

export class Error extends Schema.TaggedErrorClass<Error>()("Design.Error", {
  code: Schema.Literals(["not-found", "conflict", "invalid", "unavailable"]),
  message: Schema.String,
}) {}
