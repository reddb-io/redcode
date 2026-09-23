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
/**
 * What the design is for: a responsive web frontend, a mobile app or a presentation. It decides the
 * viewports the review and the audit use and the playbook the agent follows; `Kind` still describes
 * the artifact's shape. Documents stored before targets existed are web.
 */
export const Surface = Schema.Literals(["web", "app", "presentation"])
export type Surface = typeof Surface.Type
/** The mobile platform an app design follows (Human Interface Guidelines or Material); absent means both. */
export const Platform = Schema.Literals(["ios", "android"])
export type Platform = typeof Platform.Type

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
  /** The data-design-screen shown when the context was captured. */
  screen: Schema.String.pipe(optional),
}).annotate({ identifier: "Design.ParamContext" })
export interface ParamContext extends Schema.Schema.Type<typeof ParamContext> {}

export const Scenario = Schema.Struct({
  params: ParamValues.pipe(optional),
  id: Schema.String,
  name: Schema.String,
  variant: Schema.String.pipe(optional),
  /** A data-design-screen id the audit opens before the actions run. */
  screen: Schema.String.pipe(optional),
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

/**
 * A product source file the prototype redesigns, relative to the project root. `role` says what the file does
 * today (for example the page, its data loading or its tests) so Plan and Build evolve it instead of replacing it.
 */
export const Target = Schema.Struct({
  path: Schema.NonEmptyString.check(Schema.isMaxLength(512)),
  role: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
}).annotate({ identifier: "Design.Target" })
export interface Target extends Schema.Schema.Type<typeof Target> {}

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
/** One exported component found by a static scan of a component root; props names the matching `XProps` type when declared. */
export const Component = Schema.Struct({
  root: Schema.String,
  file: Schema.String,
  name: Schema.String,
  props: Schema.String.pipe(optional),
}).annotate({ identifier: "Design.Component" })
export interface Component extends Schema.Schema.Type<typeof Component> {}

/** The project's design system a preview build reuses; paths are project-relative and already resolved from config and defaults. */
export const System = Schema.Struct({
  paths: Schema.Array(Schema.String),
  css: Schema.Array(Schema.String),
  tailwind: Schema.Boolean,
  framework: Schema.Literals(["react", "solid"]).pipe(optional),
  aliases: Schema.Record(Schema.String, Schema.String).pipe(optional),
}).annotate({ identifier: "Design.System" })
export interface System extends Schema.Schema.Type<typeof System> {}
export const Tweaks = Schema.Record(
  Schema.String.check(Schema.isPattern(/^--[a-zA-Z][a-zA-Z0-9-]*$/)),
  Schema.String.check(Schema.isPattern(/^[^;{}<>]*$/)),
)

/** One browser review note. The user's words stay in text; the captured element context is separate. */
export const FeedbackItem = Schema.Struct({
  target: Schema.String,
  text: Schema.String,
  params: ParamContext.pipe(optional),
  tag: Schema.String.check(Schema.isMaxLength(64)).pipe(optional),
  elementText: Schema.String.check(Schema.isMaxLength(240)).pipe(optional),
  selectedText: Schema.String.check(Schema.isMaxLength(12000)).pipe(optional),
  /** The element and the named ancestors around it, innermost first, such as `svg in button "Close" in dialog "New"`. */
  label: Schema.String.check(Schema.isMaxLength(240)).pipe(optional),
  /** A secondary locator: the element's absolute XPath in the revision the note was captured on. */
  xpath: Schema.String.check(Schema.isMaxLength(2000)).pipe(optional),
  /** The containers around the element as the page showed them, outermost first. */
  context: Schema.String.check(Schema.isMaxLength(240)).pipe(optional),
  /** The element's parent and grandparent, each with its absolute XPath, innermost first. */
  parent: Schema.String.check(Schema.isMaxLength(1200)).pipe(optional),
  /** The revision the note was captured on; a draft can outlive a live reload to a newer revision. */
  revision: Schema.String.pipe(optional),
  /** The earlier note this one re-sends, so its outcome chains across rounds. */
  resent: Schema.Struct({ feedback: Schema.String, index: Schema.Int }).pipe(optional),
}).annotate({ identifier: "Design.FeedbackItem" })
export interface FeedbackItem extends Schema.Schema.Type<typeof FeedbackItem> {}

/** Legacy browsers mirrored the selected variant as a pseudo-note; it is metadata, not a note. */
const VARIANT_MARKER = /^variant:[a-zA-Z0-9_-]{1,64}$/
/** The review notes of one feedback message, in the order the rendered message numbers them (1-based). */
export function notesOf(input: { readonly items: ReadonlyArray<FeedbackItem> }) {
  return input.items.filter((item) => !VARIANT_MARKER.test(item.target))
}

/**
 * What became of one review note. `open` until the agent records an outcome after verifying the
 * revision that answers the round: `resolved` (fixed, seen in a verify), `partial` (improved, not
 * fully), `unresolved` (not fixed) or `accepted` (deliberately not changed, with a reason).
 */
export const NoteStatus = Schema.Literals(["open", "resolved", "partial", "unresolved", "accepted"])
export type NoteStatus = typeof NoteStatus.Type

/** The verify job a status cites, with the capture and findings that job recorded for the note. */
export const NoteEvidence = Schema.Struct({
  job: Schema.String,
  revision: Schema.String.pipe(optional),
  capture: Schema.String.pipe(optional),
  findings: Schema.Array(Schema.String).pipe(optional),
}).annotate({ identifier: "Design.NoteEvidence" })
export interface NoteEvidence extends Schema.Schema.Type<typeof NoteEvidence> {}

/** A note is named by the feedback message it arrived in and its 1-based number in that message. */
const NoteRef = {
  feedback: Schema.String,
  index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
}

/** Who recorded a note's status: the agent after a verify, or the reviewer from the review page. */
export const NoteRecorder = Schema.Literals(["agent", "reviewer"])
export type NoteRecorder = typeof NoteRecorder.Type

/** A review note with its durable status; `item` is the note as the browser sent it. */
export const Note = Schema.Struct({
  ...NoteRef,
  round: Schema.Int,
  item: FeedbackItem,
  status: NoteStatus,
  reason: Schema.String.pipe(optional),
  evidence: NoteEvidence.pipe(optional),
  /** Absent on statuses recorded before recorders were tracked; those came from the agent. */
  by: NoteRecorder.pipe(optional),
  updated: Schema.Number,
}).annotate({ identifier: "Design.Note" })
export interface Note extends Schema.Schema.Type<typeof Note> {}

/** What the agent records for one note after a round's verify; `open` is never set by hand. */
export const NoteUpdate = Schema.Struct({
  ...NoteRef,
  status: Schema.Literals(["resolved", "partial", "unresolved", "accepted"]),
  reason: Schema.String.check(Schema.isMaxLength(500)).pipe(optional),
  evidence: Schema.Struct({ job: Schema.String }).pipe(optional),
}).annotate({ identifier: "Design.NoteUpdate" })
export interface NoteUpdate extends Schema.Schema.Type<typeof NoteUpdate> {}

/**
 * A feedback round: the notes received, in one or more review messages, since the last revision the
 * agent published after them. `published` is the first revision published once the round had notes;
 * notes that arrive after it open the next round.
 */
export const Round = Schema.Struct({
  number: Schema.Int,
  opened: Schema.Number,
  /** The revision under review when the round opened. */
  revision: Schema.String,
  feedback: Schema.Array(Schema.String),
  published: Schema.String.pipe(optional),
}).annotate({ identifier: "Design.Round" })
export interface Round extends Schema.Schema.Type<typeof Round> {}

export const Create = Schema.Struct({
  name: Schema.NonEmptyString,
  journey: Journey,
  engine: Engine,
  kind: Kind,
  application: Schema.String.pipe(optional),
  /** Defaults to web. */
  target: Surface.pipe(optional),
  /** Only meaningful when target is app. */
  platform: Platform.pipe(optional),
}).annotate({ identifier: "Design.Create" })
export interface Create extends Schema.Schema.Type<typeof Create> {}

export const Update = Schema.Struct({
  notes: Schema.Array(NoteUpdate).check(Schema.isMaxLength(100)).pipe(optional),
  /**
   * Who records `notes`. The review page sends `reviewer`, which may only record `accepted` or
   * `unresolved` with a reason and needs no verify; the agent's tools never send it.
   */
  by: Schema.Literal("reviewer").pipe(optional),
  controls: Schema.Array(ParamComponent).check(Schema.isMaxLength(32)).pipe(optional),
  presets: Schema.Array(ParamPreset).check(Schema.isMaxLength(100)).pipe(optional),
  name: Schema.NonEmptyString.pipe(optional),
  /** Changing the target away from app drops the platform. */
  target: Surface.pipe(optional),
  /** Only accepted when the resulting target is app. */
  platform: Platform.pipe(optional),
  brief: Brief.pipe(optional),
  decisions: Schema.Array(Decision).pipe(optional),
  questions: Schema.Array(Schema.String).pipe(optional),
  scenarios: Schema.Array(Scenario).pipe(optional),
  targets: Schema.Array(Target).check(Schema.isMaxLength(20)).pipe(optional),
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
  /** Absent only on revisions and approvals recorded before targets existed; those are web. */
  target: Surface.pipe(optional),
  platform: Platform.pipe(optional),
  root: Schema.String,
  application: Schema.String,
  entry: Schema.String,
  brief: Brief,
  decisions: Schema.Array(Decision),
  questions: Schema.Array(Schema.String),
  scenarios: Schema.Array(Scenario),
  targets: Schema.Array(Target).pipe(optional),
  designSystem: Schema.String,
  system: System.pipe(optional),
  sources: Schema.Array(Source),
  inventory: Schema.Array(Component).pipe(optional),
  manifest: Schema.String.pipe(optional),
  tweaks: Tweaks,
  revision: Schema.NullOr(Schema.String),
  approvedRevision: Schema.NullOr(Schema.String),
  ended: Schema.Boolean,
  updated: Schema.Number,
  /** Feedback rounds and their notes; absent on documents that received no browser review yet. */
  rounds: Schema.Array(Round).pipe(optional),
  notes: Schema.Array(Note).pipe(optional),
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

const VariantID = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,64}$/))
export const VariantOperationKind = Schema.Literals(["delete", "rename", "reorder", "merge", "split"])
export type VariantOperationKind = typeof VariantOperationKind.Type
/**
 * A structural change the reviewer asks the agent to make to the variants of one revision. `variants`
 * names the ids involved (for merge the first one is kept; for reorder every current id), `labels`
 * their names as the page showed them, `name` the rename target, `order` the requested id order and
 * `text` optional guidance for merge or split.
 */
export const VariantOperation = Schema.Struct({
  kind: VariantOperationKind,
  variants: Schema.Array(VariantID).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  labels: Schema.Array(Schema.String.check(Schema.isMaxLength(100)))
    .check(Schema.isMaxLength(20))
    .pipe(optional),
  name: Schema.String.check(Schema.isMaxLength(100)).pipe(optional),
  order: Schema.Array(VariantID).check(Schema.isMaxLength(20)).pipe(optional),
  text: Schema.String.check(Schema.isMaxLength(2000)).pipe(optional),
}).annotate({ identifier: "Design.VariantOperation" })
export type VariantOperation = typeof VariantOperation.Type

/**
 * The per-kind rules a decoded operation must also meet. They span several fields, which the
 * generated clients cannot express, so admission enforces them instead of the schema.
 */
export function variantOperationProblem(operation: VariantOperation): string | undefined {
  const ids = operation.variants
  if (new Set(ids).size !== ids.length) return "Variant operation ids must be unique"
  if (operation.labels && operation.labels.length !== ids.length)
    return "Variant operation labels must match its variants"
  if (["delete", "rename", "split"].includes(operation.kind) && ids.length !== 1)
    return `A ${operation.kind} operation names exactly one variant`
  if (operation.kind === "merge" && ids.length < 2) return "A merge operation names at least two variants"
  if (operation.kind === "rename" ? !operation.name?.trim() : operation.name !== undefined)
    return "Only a rename operation carries a name, and it must not be empty"
  // Only the labels the page sent can be compared; the server cannot read rendered variants.
  if (operation.kind === "rename" && operation.labels?.[0]?.trim() === operation.name?.trim())
    return "A rename operation must change the variant's label"
  if (operation.kind !== "reorder" && operation.order !== undefined) return "Only a reorder operation carries an order"
  if (operation.kind === "reorder") {
    const order = operation.order ?? []
    if (ids.length < 2 || order.length !== ids.length || new Set(order).size !== order.length)
      return "A reorder operation lists every current variant once"
    if (!order.every((id) => ids.includes(id))) return "A reorder operation's order is a permutation of its variants"
  }
  if (operation.text !== undefined && operation.kind !== "merge" && operation.kind !== "split")
    return "Only merge and split operations carry guidance"
  return undefined
}

export const Feedback = Schema.Struct({
  /** A requested change to the variants themselves; the agent carries it out and publishes a revision. */
  action: VariantOperation.pipe(optional),
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
  /** One line naming a requested variant operation, such as "delete Compact". */
  operation: Schema.String.pipe(optional),
}).annotate({ identifier: "Design.FeedbackNotice" })
export interface FeedbackNotice extends Schema.Schema.Type<typeof FeedbackNotice> {}

/**
 * One entry of the review page's conversation feed, reduced on the server from the session's
 * events so both runtimes serve the same shape. `seq` is the durable cursor a client resumes from
 * (0 for replayed or live-only entries); `id` lets a client merge repeats of the same entry.
 */
const FeedBase = { seq: Schema.Number, at: Schema.Number }
export const FeedEvent = Schema.Union([
  Schema.Struct({ ...FeedBase, type: Schema.Literal("state"), state: Schema.Literals(["working", "idle"]) }),
  Schema.Struct({
    ...FeedBase,
    type: Schema.Literal("user"),
    id: Schema.String,
    text: Schema.String,
    /** Review notes attached to the message; the client renders the count in its own language. */
    notes: Schema.Number,
    /** True while the prompt is admitted but not yet delivered into a turn; absent once a turn takes it up. */
    pending: Schema.Boolean.pipe(optional),
  }),
  Schema.Struct({ ...FeedBase, type: Schema.Literal("reply"), id: Schema.String, text: Schema.String }),
  Schema.Struct({
    ...FeedBase,
    type: Schema.Literal("tool"),
    id: Schema.String,
    tool: Schema.String,
    status: Schema.Literals(["running", "done", "failed"]),
    summary: Schema.String,
  }),
  Schema.Struct({
    ...FeedBase,
    type: Schema.Literal("published"),
    design: ID,
    revision: Schema.String,
    name: Schema.String,
  }),
  Schema.Struct({ ...FeedBase, type: Schema.Literal("agent"), agent: Schema.String }),
  /** A round's verify job finished: one verdict per note, with a link to the job's report and captures. */
  Schema.Struct({
    ...FeedBase,
    type: Schema.Literal("verified"),
    design: ID,
    revision: Schema.String,
    round: Schema.Int,
    job: Schema.String,
    notes: Schema.Array(
      Schema.Struct({
        feedback: Schema.String,
        index: Schema.Int,
        label: Schema.String,
        /** pass: found with no findings; warn: found with advisory findings; fail: missing or a blocking finding. */
        verdict: Schema.Literals(["pass", "warn", "fail"]),
        reason: Schema.String,
      }),
    ),
  }),
]).annotate({ identifier: "Design.FeedEvent" })
export type FeedEvent = typeof FeedEvent.Type

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
  format: Schema.Literals(["html", "gif", "audit", "compare", "verify"]),
  /** With format verify: the feedback round whose notes are verified against `revision`; the latest round by default. */
  round: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(optional),
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

/** What a round's verify job observed for one note on the new revision. */
export const VerifyNote = Schema.Struct({
  feedback: Schema.String,
  index: Schema.Int,
  label: Schema.String,
  /** The note's element was located in the new revision (by data-design-id, selector or XPath). */
  found: Schema.Boolean,
  /** A missing element or an error-severity finding inside the element's container. */
  blocking: Schema.Boolean,
  /** Focused captures of the element on the revision the note was taken on and on the new one. */
  before: Schema.String.pipe(optional),
  after: Schema.String.pipe(optional),
  findings: Schema.Array(Schema.String),
  scenarios: Schema.Array(Schema.String),
  /** One line a reviewer can read: found or missing, and what was observed. */
  reason: Schema.String,
}).annotate({ identifier: "Design.VerifyNote" })
export interface VerifyNote extends Schema.Schema.Type<typeof VerifyNote> {}

export const Verify = Schema.Struct({
  revision: Schema.String,
  round: Schema.Int,
  width: Schema.Number,
  notes: Schema.Array(VerifyNote),
  findings: Schema.Array(Schema.String),
}).annotate({ identifier: "Design.Verify" })
export interface Verify extends Schema.Schema.Type<typeof Verify> {}

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
  verify: Verify.pipe(optional),
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
