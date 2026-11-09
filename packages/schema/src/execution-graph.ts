export * as ExecutionGraph from "./execution-graph.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
import { Pty } from "./pty.js"
import { NonNegativeInt, optional } from "./schema.js"
import { Session } from "./session.js"
import { Shell } from "./shell.js"

export const Status = Schema.Literals([
  "pending",
  "running",
  "waiting",
  "suspended",
  "idle",
  "succeeded",
  "failed",
  "cancelled",
])
export type Status = typeof Status.Type

const Base = {
  id: Schema.String,
  sessionID: Session.ID,
  status: Status,
}

export const SessionNode = Schema.Struct({
  ...Base,
  kind: Schema.tag("session"),
  title: Schema.String.pipe(optional),
  agent: Agent.ID.pipe(optional),
  started: Schema.Finite,
  updated: Schema.Finite,
  completed: Schema.Finite.pipe(optional),
}).annotate({ identifier: "ExecutionGraph.SessionNode" })
export interface SessionNode extends Schema.Schema.Type<typeof SessionNode> {}

export const JobNode = Schema.Struct({
  ...Base,
  kind: Schema.tag("job"),
  jobID: Schema.String,
  jobType: Schema.String,
  title: Schema.String.pipe(optional),
  started: Schema.Finite,
  completed: Schema.Finite.pipe(optional),
}).annotate({ identifier: "ExecutionGraph.JobNode" })
export interface JobNode extends Schema.Schema.Type<typeof JobNode> {}

export const ShellNode = Schema.Struct({
  ...Base,
  kind: Schema.tag("shell"),
  shellID: Shell.ID,
  started: Schema.Finite,
  completed: Schema.Finite.pipe(optional),
  exit: Schema.Finite.pipe(optional),
}).annotate({ identifier: "ExecutionGraph.ShellNode" })
export interface ShellNode extends Schema.Schema.Type<typeof ShellNode> {}

export const TerminalNode = Schema.Struct({
  ...Base,
  kind: Schema.tag("terminal"),
  ptyID: Pty.ID,
  title: Schema.String,
  pid: NonNegativeInt,
}).annotate({ identifier: "ExecutionGraph.TerminalNode" })
export interface TerminalNode extends Schema.Schema.Type<typeof TerminalNode> {}

export const Node = Schema.Union([SessionNode, JobNode, ShellNode, TerminalNode]).annotate({
  identifier: "ExecutionGraph.Node",
})
export type Node = typeof Node.Type

export const Edge = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  relation: Schema.Literals(["delegates", "starts", "executes", "runs", "owns"]),
}).annotate({ identifier: "ExecutionGraph.Edge" })
export interface Edge extends Schema.Schema.Type<typeof Edge> {}

export const Info = Schema.Struct({
  rootSessionID: Session.ID,
  generatedAt: Schema.Finite,
  nodes: Schema.Array(Node),
  edges: Schema.Array(Edge),
  truncated: Schema.Struct({ shells: Schema.Boolean }),
}).annotate({ identifier: "ExecutionGraph.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
