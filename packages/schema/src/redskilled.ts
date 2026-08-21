export * as Redskilled from "./redskilled"

import { Schema } from "effect"
import { optional } from "./schema"

export const Consent = Schema.Literals(["unknown", "accepted", "refused"])
export type Consent = typeof Consent.Type

export const Lifecycle = Schema.Literals([
  "unavailable",
  "ineligible",
  "needs_consent",
  "connecting",
  "live",
  "degraded",
  "refused",
])
export type Lifecycle = typeof Lifecycle.Type

export const Scope = Schema.Literals(["project", "host"])
export type Scope = typeof Scope.Type

export const Activation = Schema.Struct({
  eligible: Schema.Boolean,
  project: Schema.String,
  runner: Schema.String,
  target: Schema.Int.pipe(optional),
  standing: Schema.Boolean.pipe(optional),
  config: Schema.String.pipe(optional),
})
export type Activation = typeof Activation.Type

export const Display = Schema.Struct({
  runner: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  origin: Schema.NullOr(Schema.String),
  issue: Schema.NullOr(Schema.String),
  phase: Schema.NullOr(Schema.String),
  step: Schema.NullOr(Schema.String),
  phase_index: Schema.NullOr(Schema.Int),
  phase_total: Schema.NullOr(Schema.Int),
  failed: Schema.Boolean,
  heartbeat: Schema.NullOr(Schema.String),
  started_at: Schema.NullOr(Schema.String),
  context: Schema.NullOr(Schema.Number),
  eta: Schema.NullOr(Schema.Number),
  added: Schema.NullOr(Schema.Number),
  removed: Schema.NullOr(Schema.Number),
  tokens: Schema.NullOr(Schema.Number),
  tools: Schema.NullOr(Schema.Number),
  reasoning: Schema.NullOr(Schema.Number),
  text: Schema.NullOr(Schema.Number),
})
export type Display = typeof Display.Type

export const Worker = Schema.Struct({
  worker_id: Schema.String,
  project_label: Schema.String,
  pid: Schema.Int,
  started_at: Schema.String,
  uptime_ms: Schema.NullOr(Schema.Number),
  vitals: Schema.Struct({
    rss_bytes: Schema.NullOr(Schema.Number),
    sampled_at: Schema.NullOr(Schema.String),
    age_ms: Schema.NullOr(Schema.Number),
    fresh: Schema.Boolean,
    rss_source: Schema.NullOr(Schema.String).pipe(optional),
  }),
  budget: Schema.Struct({
    declared: Schema.NullOr(Schema.String),
    bytes: Schema.NullOr(Schema.Number),
    used_bytes: Schema.NullOr(Schema.Number),
    used_fraction: Schema.NullOr(Schema.Number),
    enforceable: Schema.Boolean,
  }),
  log: Schema.Struct({
    last_line: Schema.NullOr(Schema.String),
    published_at: Schema.NullOr(Schema.String),
  }),
  display: Schema.NullOr(Display).pipe(optional),
})
export type Worker = typeof Worker.Type

export const Payload = Schema.Struct({
  version: Schema.Literal(1),
  generated_at: Schema.String,
  daemon: Schema.Struct({
    pid: Schema.Int,
    daemon_version: Schema.String,
    protocol_version: Schema.Int,
    started_at: Schema.String,
  }).pipe(optional),
  staleness: Schema.Struct({
    sampled_at: Schema.NullOr(Schema.String),
    age_ms: Schema.NullOr(Schema.Number),
    threshold_ms: Schema.Number.pipe(optional),
    stale: Schema.Boolean,
    measured_worker_count: Schema.Int,
    unmeasured_workers: Schema.Array(Schema.String),
    reason: Schema.String,
  }),
  host: Schema.Struct({
    worker_count: Schema.Int,
    project_count: Schema.Int,
    observed_rss_bytes: Schema.Number.pipe(optional),
    measured_worker_count: Schema.Int,
    ceiling_used_fraction: Schema.NullOr(Schema.Number),
    ceiling: Schema.Struct({
      memory_bytes: Schema.NullOr(Schema.Number),
      worker_count: Schema.NullOr(Schema.Int),
      interactive_reservation: Schema.Int.pipe(optional),
    }),
  }),
  known_projects: Schema.Array(Schema.String).pipe(optional),
  registered_projects: Schema.Array(Schema.String).pipe(optional),
  workers: Schema.Array(Worker),
})
export type Payload = typeof Payload.Type

export const Status = Schema.Struct({
  lifecycle: Lifecycle,
  consent: Consent,
  scope: Scope,
  native: Schema.Literal(true),
  activation: Activation.pipe(optional),
  payload: Payload.pipe(optional),
  last_success_at: Schema.String.pipe(optional),
  error: Schema.String.pipe(optional),
})
export type Status = typeof Status.Type

export const ConsentInput = Schema.Struct({ decision: Schema.Literals(["accepted", "refused"]) })
export const ResizeInput = Schema.Struct({ target: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) })
export const WorkerInput = Schema.Struct({ worker: Schema.String })
export const SteerInput = Schema.Struct({ worker: Schema.String, text: Schema.String })
export const SteerStatus = Schema.Struct({
  worker: Schema.String,
  status: Schema.Literals(["none", "pending", "consumed"]),
  iteration: Schema.Int.pipe(optional),
})
export type SteerStatus = typeof SteerStatus.Type
