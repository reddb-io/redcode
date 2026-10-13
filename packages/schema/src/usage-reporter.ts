export * as UsageReporter from "./usage-reporter.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Number = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const ID = Schema.NonEmptyString.check(Schema.isMaxLength(256))

export interface Configure extends Schema.Schema.Type<typeof Configure> {}
export const Configure = Schema.Struct({
  enabled: Schema.Boolean,
  transport: Schema.Literals(["webhook", "reddb"]),
  url: Schema.String.check(Schema.isMaxLength(2048)),
  queue: Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/)),
  secret: Schema.String.check(Schema.isMaxLength(4096)).pipe(optional),
}).annotate({ identifier: "UsageReporter.Configure" })

export interface Config extends Schema.Schema.Type<typeof Config> {}
export const Config = Schema.Struct({
  enabled: Schema.Boolean,
  transport: Configure.fields.transport,
  url: Schema.String,
  queue: Schema.String,
  secretConfigured: Schema.Boolean,
  instanceID: ID,
  since: Number,
}).annotate({ identifier: "UsageReporter.Config" })

// No opaque metadata or free-text payload fields. Producers construct this projection explicitly.
export interface Record extends Schema.Schema.Type<typeof Record> {}
export const Record = Schema.Struct({
  id: ID,
  version: Schema.Literal(1),
  type: Schema.Literals(["model.usage.recorded", "session.summary.updated"]),
  instanceID: ID,
  sessionID: ID,
  nativeSessionID: Schema.NullOr(ID),
  parentSessionID: Schema.NullOr(ID),
  projectID: Schema.NullOr(ID),
  workspaceID: Schema.NullOr(ID),
  source: Schema.Literals(["native", "claude", "codex"]),
  stage: Schema.Literals(["s1", "s2", "auxiliary", "external", "session"]),
  scope: Schema.Literals(["step", "evaluation", "interaction", "session"]),
  coverage: Schema.Literals(["own_session", "main_loop", "session_tree", "native_session"]),
  operation: Schema.Literals(["generation", "evaluation", "compaction", "title", "summary"]),
  provider: Schema.NullOr(ID),
  model: Schema.NullOr(ID),
  messageID: Schema.NullOr(ID),
  messageSequence: Schema.NullOr(Count),
  revision: Schema.NullOr(Count),
  usageRecords: Count,
  unknownUsageRecords: Count,
  unpricedRecords: Count,
  retryCount: Schema.NullOr(Count),
  messages: Schema.Struct({ total: Schema.NullOr(Count), user: Schema.NullOr(Count), assistant: Schema.NullOr(Count) }),
  status: Schema.Literals(["succeeded", "failed", "cancelled", "busy", "idle", "unknown"]),
  tokens: Schema.NullOr(
    Schema.Struct({
      input: Schema.NullOr(Number),
      output: Schema.NullOr(Number),
      reasoning: Schema.NullOr(Number),
      cache: Schema.Struct({ read: Schema.NullOr(Number), write: Schema.NullOr(Number) }),
    }),
  ),
  usageBasis: Schema.Literals(["recorded", "reported", "unknown"]),
  cost: Schema.NullOr(Number),
  currency: Schema.Literal("USD"),
  pricingBasis: Schema.Literals(["recorded", "reported", "estimated", "unknown"]),
  startedAt: Number,
  completedAt: Schema.NullOr(Number),
  durationMs: Schema.NullOr(Number),
  firstOutputMs: Schema.NullOr(Number),
  streamDurationMs: Schema.NullOr(Number),
  tools: Schema.NullOr(
    Schema.Struct({ calls: Count, succeeded: Count, failed: Count, unfinished: Count, durationMs: Number }),
  ),
}).annotate({ identifier: "UsageReporter.Record" })

export interface Delivery extends Schema.Schema.Type<typeof Delivery> {}
export const Delivery = Schema.Struct({
  id: ID,
  status: Schema.Literals(["pending", "sending", "delivered", "dead"]),
  attempts: Count,
  nextAttemptAt: Number,
  httpStatus: Schema.NullOr(Count),
  error: Schema.NullOr(Schema.Literals(["network", "http", "configuration"])),
  record: Record,
}).annotate({ identifier: "UsageReporter.Delivery" })

export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
export const Snapshot = Schema.Struct({
  config: Config,
  counts: Schema.Struct({ pending: Count, delivered: Count, dead: Count }),
  deliveries: Schema.Array(Delivery),
}).annotate({ identifier: "UsageReporter.Snapshot" })
