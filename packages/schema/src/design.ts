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

const ParamID = Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/))
export const ParamValues = Schema.Record(
  Schema.String,
  Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Finite, Schema.Boolean])),
).annotate({ identifier: "Design.ParamValues" })
export type ParamValues = typeof ParamValues.Type

const FieldBase = { id: ParamID, name: Schema.NonEmptyString }
export const ParamField = Schema.Union([
  Schema.Struct({ ...FieldBase, type: Schema.Literal("text"), default: Schema.String }),
  Schema.Struct({ ...FieldBase, type: Schema.Literal("boolean"), default: Schema.Boolean }),
  Schema.Struct({
    ...FieldBase,
    type: Schema.Literal("number"),
    default: Schema.Finite,
    min: Schema.Finite.pipe(optional),
    max: Schema.Finite.pipe(optional),
  }),
  Schema.Struct({
    ...FieldBase,
    type: Schema.Literal("select"),
    default: Schema.String,
    options: Schema.Array(Schema.String),
  }),
]).annotate({ identifier: "Design.ParamField" })
export type ParamField = typeof ParamField.Type
export const ParamComponent = Schema.Struct({
  id: ParamID,
  name: Schema.NonEmptyString,
  selector: Schema.NonEmptyString,
  variant: Schema.String.pipe(optional),
  fields: Schema.Array(ParamField).check(Schema.isMaxLength(32)),
}).annotate({ identifier: "Design.ParamComponent" })
export interface ParamComponent extends Schema.Schema.Type<typeof ParamComponent> {}
export const ParamPreset = Schema.Struct({
  id: ParamID,
  name: Schema.NonEmptyString,
  variant: Schema.String.pipe(optional),
  values: ParamValues,
}).annotate({ identifier: "Design.ParamPreset" })
export interface ParamPreset extends Schema.Schema.Type<typeof ParamPreset> {}
export const ParamContext = Schema.Struct({
  values: ParamValues,
  preset: Schema.String.pipe(optional),
  variant: Schema.String.pipe(optional),
  component: Schema.String.pipe(optional),
}).annotate({ identifier: "Design.ParamContext" })
export interface ParamContext extends Schema.Schema.Type<typeof ParamContext> {}

export const Scenario = Schema.Struct({
  params: ParamValues.pipe(optional),
  id: Schema.String,
  name: Schema.String,
  variant: Schema.String.pipe(optional),
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
  controls: Schema.Array(ParamComponent).check(Schema.isMaxLength(32)).pipe(optional),
  presets: Schema.Array(ParamPreset).check(Schema.isMaxLength(100)).pipe(optional),
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
  controls: Schema.Array(ParamComponent).check(Schema.isMaxLength(32)).pipe(optional),
  presets: Schema.Array(ParamPreset).check(Schema.isMaxLength(100)).pipe(optional),
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

/** One browser review note. The user's words stay in text; the captured element context is separate. */
export const FeedbackItem = Schema.Struct({
  target: Schema.String,
  text: Schema.String,
  params: ParamContext.pipe(optional),
  tag: Schema.String.check(Schema.isMaxLength(64)).pipe(optional),
  elementText: Schema.String.check(Schema.isMaxLength(240)).pipe(optional),
  selectedText: Schema.String.check(Schema.isMaxLength(12000)).pipe(optional),
  label: Schema.String.check(Schema.isMaxLength(120)).pipe(optional),
}).annotate({ identifier: "Design.FeedbackItem" })
export interface FeedbackItem extends Schema.Schema.Type<typeof FeedbackItem> {}

export const Feedback = Schema.Struct({
  params: ParamContext.pipe(optional),
  id: SessionMessage.ID,
  revision: Schema.String,
  text: Schema.String,
  items: Schema.Array(FeedbackItem),
  assets: Schema.Array(Schema.String),
  snapshot: Schema.String,
  whiteboards: Schema.Array(Schema.Struct({ target: Schema.String, scene: Schema.Unknown })).pipe(optional),
  delivery: Schema.Literals(["steer", "queue"]),
  end: Schema.Boolean,
}).annotate({ identifier: "Design.Feedback" })
export interface Feedback extends Schema.Schema.Type<typeof Feedback> {}

/** Compact transcript summary of admitted browser feedback; the rendered message carries the detail. */
export const FeedbackNotice = Schema.Struct({
  id: ID,
  feedback: SessionMessage.ID,
  revision: Schema.String,
  variant: Schema.NullOr(Schema.String),
  ended: Schema.Boolean,
  text: Schema.String,
  notes: Schema.Array(Schema.Struct({ label: Schema.String, text: Schema.String })),
  attachments: Schema.Array(Schema.String),
  snapshot: Schema.Boolean,
}).annotate({ identifier: "Design.FeedbackNotice" })
export interface FeedbackNotice extends Schema.Schema.Type<typeof FeedbackNotice> {}

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

export const AuditCheck = Schema.Struct({
  rule: Schema.String,
  severity: Schema.Literals(["error", "review"]),
  selector: Schema.String,
  evidence: Schema.String,
  fix: Schema.String,
  width: Schema.Number,
  variant: Schema.String.pipe(optional),
  scenario: Schema.String.pipe(optional),
}).annotate({ identifier: "Design.AuditCheck" })
export interface AuditCheck extends Schema.Schema.Type<typeof AuditCheck> {}

export const AuditCapture = Schema.Struct({
  file: Schema.String,
  width: Schema.Number,
  variant: Schema.String.pipe(optional),
  scenario: Schema.String.pipe(optional),
  fullPage: Schema.Boolean,
}).annotate({ identifier: "Design.AuditCapture" })
export interface AuditCapture extends Schema.Schema.Type<typeof AuditCapture> {}

export const Audit = Schema.Struct({
  revision: Schema.String,
  findings: Schema.Array(Schema.String),
  scenarios: Schema.Array(Schema.String),
  widths: Schema.Array(Schema.Number),
  checks: Schema.Array(AuditCheck).pipe(optional),
  captures: Schema.Array(AuditCapture).pipe(optional),
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
