export * as Harness from "./harness.js"

import { Schema } from "effect"
import { AbsolutePath, optional } from "./schema.js"

export const Driver = Schema.Literals(["claude", "codex"]).annotate({ identifier: "Harness.Driver" })
export type Driver = typeof Driver.Type
export const Config = Schema.Struct({ driver: Driver, executable: Schema.NonEmptyString }).annotate({
  identifier: "Harness.Config",
})
export interface Config extends Schema.Schema.Type<typeof Config> {}
export const Provider = Schema.Struct({
  driver: Driver,
  executable: Schema.String,
  installed: Schema.Boolean,
  version: optional(Schema.String),
  authenticated: optional(Schema.Boolean),
  detail: optional(Schema.String),
  models: optional(
    Schema.Array(Schema.Struct({ id: Schema.String, label: Schema.String, recommended: Schema.Boolean })),
  ),
}).annotate({ identifier: "Harness.Provider" })
export interface Provider extends Schema.Schema.Type<typeof Provider> {}
export const Open = Schema.Struct({
  driver: Driver,
  directory: AbsolutePath,
  model: optional(Schema.NonEmptyString),
}).annotate({ identifier: "Harness.Open" })
export interface Open extends Schema.Schema.Type<typeof Open> {}
export const State = Schema.Literals([
  "starting",
  "ready",
  "running",
  "waiting",
  "interrupted",
  "failed",
  "unknown",
  "closed",
]).annotate({ identifier: "Harness.State" })
export type State = typeof State.Type
export const Run = Schema.Struct({
  id: Schema.String,
  driver: Driver,
  directory: AbsolutePath,
  model: optional(Schema.String),
  nativeID: optional(Schema.String),
  state: State,
  createdAt: Schema.String,
  detail: optional(Schema.String),
  queued: Schema.Int,
  capabilities: Schema.Struct({ steer: Schema.Boolean, resume: Schema.Boolean, interrupt: Schema.Boolean }),
}).annotate({ identifier: "Harness.Run" })
export interface Run extends Schema.Schema.Type<typeof Run> {}
export const Question = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  options: Schema.Array(Schema.String),
}).annotate({ identifier: "Harness.Question" })
export interface Question extends Schema.Schema.Type<typeof Question> {}
export const Request = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["permission", "question", "unsupported"]),
  title: Schema.String,
  detail: Schema.String,
  questions: Schema.Array(Question),
}).annotate({ identifier: "Harness.Request" })
export interface Request extends Schema.Schema.Type<typeof Request> {}
export const Event = Schema.Struct({
  cursor: Schema.Int,
  kind: Schema.Literals(["text", "activity", "error"]),
  text: Schema.String,
}).annotate({ identifier: "Harness.Event" })
export interface Event extends Schema.Schema.Type<typeof Event> {}
export const Detail = Schema.Struct({
  run: Run,
  events: Schema.Array(Event),
  requests: Schema.Array(Request),
}).annotate({ identifier: "Harness.Detail" })
export interface Detail extends Schema.Schema.Type<typeof Detail> {}
export const Snapshot = Schema.Struct({ providers: Schema.Array(Provider), runs: Schema.Array(Run) }).annotate({
  identifier: "Harness.Snapshot",
})
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
export const Prompt = Schema.Struct({
  id: Schema.NonEmptyString,
  text: Schema.NonEmptyString,
  delivery: Schema.Literals(["steer", "queue"]),
}).annotate({ identifier: "Harness.Prompt" })
export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}
export const Answer = Schema.Struct({
  request: Schema.String,
  allow: Schema.Boolean,
  answers: Schema.Record(Schema.String, Schema.String),
}).annotate({ identifier: "Harness.Answer" })
export interface Answer extends Schema.Schema.Type<typeof Answer> {}
export const Login = Schema.Struct({
  driver: Driver,
  state: Schema.Literals(["pending", "complete", "failed"]),
  url: optional(Schema.String),
  code: optional(Schema.String),
  detail: optional(Schema.String),
}).annotate({ identifier: "Harness.Login" })
export interface Login extends Schema.Schema.Type<typeof Login> {}
