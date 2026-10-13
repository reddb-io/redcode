export * as WorkerEnvironment from "./worker-environment.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { Worker } from "./worker.js"

const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))
export const Create = Schema.Struct({
  id: Worker.Name,
  repository: Text,
  ref: Text,
  image: Text,
  cpu: Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(128)),
  memoryMiB: Schema.Int.check(Schema.isGreaterThanOrEqualTo(256), Schema.isLessThanOrEqualTo(1048576)),
  setup: optional(Schema.String.check(Schema.isMaxLength(8192))),
  provider: optional(Schema.Struct({ integrationID: Text, key: Text })),
}).annotate({ identifier: "WorkerEnvironment.Create" })
export interface Create extends Schema.Schema.Type<typeof Create> {}

export const Info = Schema.Struct({
  id: Worker.Name,
  repository: Text,
  ref: Text,
  image: Text,
  cpu: Create.fields.cpu,
  imageID: optional(Schema.String),
  memoryMiB: Create.fields.memoryMiB,
  directory: Schema.Literal("/workspace/project"),
  state: Schema.Literals(["preparing", "ready", "stopped", "archived", "failed", "reconcile"]),
  phase: Schema.Literals(["container", "clone", "checkout", "setup", "server", "complete"]),
  createdAt: Schema.String,
  commit: optional(Schema.String),
  error: optional(Schema.String),
}).annotate({ identifier: "WorkerEnvironment.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Snapshot = Schema.Struct({
  available: Schema.Boolean,
  engine: Schema.String,
  environments: Schema.Array(Info),
}).annotate({ identifier: "WorkerEnvironment.Snapshot" })
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}

/** HTTP only. The host resolves the container and supplies its private credential. */
export const Request = Schema.Struct({
  method: Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: Text,
  body: optional(Schema.String.check(Schema.isMaxLength(1048576))),
}).annotate({ identifier: "WorkerEnvironment.Request" })
export interface Request extends Schema.Schema.Type<typeof Request> {}
export const Response = Schema.Struct({ status: Schema.Int, body: Schema.String, contentType: Schema.String }).annotate({
  identifier: "WorkerEnvironment.Response",
})
export interface Response extends Schema.Schema.Type<typeof Response> {}
