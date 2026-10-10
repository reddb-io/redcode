export * as SessionImport from "./session-import.js"

import { Schema } from "effect"
import { DateTimeUtcFromMillis, NonNegativeInt, optional } from "./schema.js"

/** Coding agents whose local session history can be imported. */
export const Source = Schema.Literals(["opencode", "claude-code", "pi", "omp", "codex"]).annotate({ identifier: "SessionImport.Source" })
export type Source = typeof Source.Type

export interface SourceInfo extends Schema.Schema.Type<typeof SourceInfo> {}
export const SourceInfo = Schema.Struct({
  source: Source,
  name: Schema.String,
  available: Schema.Boolean,
  /** The detected local session store, when one exists. */
  path: Schema.String.pipe(optional),
  /** Top-level sessions in the detected store. */
  sessions: NonNegativeInt,
  /** Why the source cannot be read, or what is limited about it. */
  warning: Schema.String.pipe(optional),
}).annotate({ identifier: "SessionImport.SourceInfo" })

export interface Summary extends Schema.Schema.Type<typeof Summary> {}
export const Summary = Schema.Struct({
  source: Source,
  /** The source's own session identifier. */
  ref: Schema.String,
  title: Schema.String,
  /** The source-recorded working directory, canonicalized for this host. Arbitrary when the source recorded none. */
  directory: Schema.String,
  /** Messages in the session; an estimate for sources whose stores are too large to count when listing. */
  messages: NonNegativeInt,
  /** Whether `messages` is an estimate rather than a count. */
  estimated: Schema.Boolean.pipe(optional),
  /** Direct subagent sessions imported with this session. */
  subagents: NonNegativeInt,
  /** The last model the session used, as `provider/model`. */
  model: Schema.String.pipe(optional),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
  }),
}).annotate({ identifier: "SessionImport.Summary" })
