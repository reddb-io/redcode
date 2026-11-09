export * as SessionExecutionGraph from "./execution-graph.js"

import { ExecutionGraph } from "@opencode/schema/execution-graph"
import { Shell } from "@opencode/schema/shell"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, DateTime, Effect, Layer } from "effect"
import { Job } from "../job.js"
import { PersistentPty } from "../persistent-pty/index.js"
import { Session } from "../session.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"
import { SessionWait } from "./wait.js"

const sessionNodeID = (id: SessionSchema.ID) => `session:${id}`
const jobNodeID = (id: string) => `job:${id}`
const shellNodeID = (id: string) => `shell:${id}`
const terminalNodeID = (id: string) => `terminal:${id}`
const DEFAULT_SHELL_LIMIT = 200

const make = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const store = yield* SessionStore.Service
  const jobs = yield* Job.Service
  const terminals = yield* PersistentPty.Service

  const family = (session: SessionSchema.Info): Effect.Effect<SessionSchema.Info[]> =>
    Effect.gen(function* () {
      const children = yield* store.list({ parentID: session.id, archived: "include", order: "asc" })
      const descendants = yield* Effect.forEach(children, family)
      return [session, ...descendants.flat()]
    })

  const snapshot = Effect.fn("SessionExecutionGraph.snapshot")(function* (
    rootSessionID: SessionSchema.ID,
    options?: { readonly shellLimit?: number },
  ) {
    const root = yield* store.get(rootSessionID)
    if (!root) return undefined

    const related = yield* family(root)
    const relatedIDs = new Set(related.map((session) => session.id))
    const active = yield* sessions.active
    const suspended = new Set(yield* store.listSuspended())
    const shellLimit = options?.shellLimit ?? DEFAULT_SHELL_LIMIT
    const candidates = (
      yield* Effect.forEach(related, (session) =>
        store.messages({ sessionID: session.id, type: "shell", limit: shellLimit + 1, order: "desc" }).pipe(
          Effect.orDie,
          Effect.map((messages) => ({ sessionID: session.id, messages })),
        ),
      )
    ).flatMap((entry) =>
      entry.messages.flatMap((message) => (message.type === "shell" ? [{ sessionID: entry.sessionID, message }] : [])),
    )
    const messages = candidates
      .toSorted((a, b) => DateTime.toEpochMillis(b.message.time.created) - DateTime.toEpochMillis(a.message.time.created))
      .slice(0, shellLimit)
    const shellByID = new Map(messages.map((entry) => [entry.message.shellID, entry]))
    const background = (yield* jobs.pendingBackground).filter((entry) => {
      const sessionID =
        entry.recovery.kind === "subagent" ? entry.recovery.childSessionID : entry.recovery.sessionID
      return relatedIDs.has(sessionID)
    })
    const live = (
      yield* Effect.forEach(
        [
          ...related.map((session) => ({ id: session.id, sessionID: session.id })),
          ...messages.map((entry) => ({ id: entry.message.shellID, sessionID: entry.sessionID })),
        ],
        (candidate) =>
          jobs
            .get(candidate.id)
            .pipe(Effect.map((job) => (job ? { job, sessionID: candidate.sessionID } : undefined))),
      )
    ).filter((entry) => entry !== undefined)
    const jobByID = new Map<string, Job.Background | Job.Info>(background.map((job) => [job.id, job]))
    const jobSessionByID = new Map(
      background.map((job) => [
        job.id,
        job.recovery.kind === "subagent" ? job.recovery.childSessionID : job.recovery.sessionID,
      ]),
    )
    live.forEach((entry) => {
      jobByID.set(entry.job.id, entry.job)
      jobSessionByID.set(entry.job.id, entry.sessionID)
    })
    const persistent = yield* terminals.list().pipe(
      Effect.catchTag("PersistentPty.UnavailableError", () => Effect.succeed([])),
      Effect.map((items) => items.filter((terminal) => relatedIDs.has(terminal.sessionID))),
    )

    const sessionNodes = related.map((session): ExecutionGraph.SessionNode => ({
      id: sessionNodeID(session.id),
      kind: "session",
      sessionID: session.id,
      status:
        active.has(session.id) && SessionWait.list(session.id).length > 0
          ? "waiting"
          : active.has(session.id)
            ? "running"
            : suspended.has(session.id)
              ? "suspended"
              : session.outcome === "succeeded"
                ? "succeeded"
                : session.outcome === "failed"
                  ? "failed"
                  : session.outcome === "interrupted"
                    ? "cancelled"
                    : "idle",
      title: session.title,
      agent: session.agent,
      started: DateTime.toEpochMillis(session.time.created),
      updated: DateTime.toEpochMillis(session.time.updated),
      completed: session.time.idle ? DateTime.toEpochMillis(session.time.idle) : undefined,
    }))
    const shellNodes = messages.map(({ sessionID, message }): ExecutionGraph.ShellNode => ({
      id: shellNodeID(message.shellID),
      kind: "shell",
      shellID: message.shellID,
      sessionID,
      status:
        message.status === "running"
          ? "running"
          : message.status === "killed"
            ? "cancelled"
            : message.status === "exited" && (message.exit ?? 0) === 0
              ? "succeeded"
              : "failed",
      started: DateTime.toEpochMillis(message.time.created),
      completed: message.time.completed ? DateTime.toEpochMillis(message.time.completed) : undefined,
      exit: message.exit,
    }))
    const jobNodes = [...jobByID.values()].map((job): ExecutionGraph.JobNode => {
      const recovery = "recovery" in job ? job.recovery : undefined
      const sessionID = jobSessionByID.get(job.id)!
      const session = related.find((item) => item.id === sessionID)!
      const shell = recovery?.kind === "shell" ? shellByID.get(Shell.ID.make(recovery.shellID))?.message : undefined
      const started = "started_at" in job ? job.started_at : shell ? DateTime.toEpochMillis(shell.time.created) : DateTime.toEpochMillis(session.time.created)
      return {
        id: jobNodeID(job.id),
        kind: "job",
        jobID: job.id,
        jobType: "type" in job ? job.type : recovery?.kind ?? "background",
        sessionID,
        status:
          job.status === "running"
            ? "running"
            : job.status === "completed"
              ? "succeeded"
              : job.status === "cancelled"
                ? "cancelled"
                : "failed",
        title: "title" in job ? job.title : undefined,
        started,
        completed: "completed_at" in job ? job.completed_at : undefined,
      }
    })
    const terminalNodes = persistent.map((terminal): ExecutionGraph.TerminalNode => ({
      id: terminalNodeID(terminal.id),
      kind: "terminal",
      ptyID: terminal.id,
      sessionID: terminal.sessionID,
      status: terminal.status === "running" ? "running" : terminal.exitCode === 0 ? "succeeded" : "failed",
      title: terminal.title,
      pid: terminal.pid,
    }))

    const sessionEdges = related.flatMap((session): ExecutionGraph.Edge[] =>
      session.parentID && relatedIDs.has(session.parentID)
        ? [{ from: sessionNodeID(session.parentID), to: sessionNodeID(session.id), relation: "delegates" }]
        : [],
    )
    const shellEdges = shellNodes.map((shell): ExecutionGraph.Edge => ({
      from: jobByID.has(shell.shellID) ? jobNodeID(shell.shellID) : sessionNodeID(shell.sessionID),
      to: shell.id,
      relation: jobByID.has(shell.shellID) ? "executes" : "runs",
    }))
    const jobEdges = [...jobByID.values()].flatMap((job): ExecutionGraph.Edge[] => {
      const recovery = "recovery" in job ? job.recovery : undefined
      if (recovery?.kind === "subagent")
        return [
          { from: sessionNodeID(recovery.parentSessionID), to: jobNodeID(job.id), relation: "starts" },
          { from: jobNodeID(job.id), to: sessionNodeID(recovery.childSessionID), relation: "executes" },
        ]
      const sessionID = jobSessionByID.get(job.id)!
      return [{ from: sessionNodeID(sessionID), to: jobNodeID(job.id), relation: "starts" }]
    })
    const terminalEdges = terminalNodes.map((terminal): ExecutionGraph.Edge => ({
      from: sessionNodeID(terminal.sessionID),
      to: terminal.id,
      relation: "owns",
    }))

    return ExecutionGraph.Info.make({
      rootSessionID,
      generatedAt: Date.now(),
      nodes: [...sessionNodes, ...jobNodes, ...shellNodes, ...terminalNodes],
      edges: [...sessionEdges, ...jobEdges, ...shellEdges, ...terminalEdges],
      truncated: { shells: candidates.length > messages.length },
    })
  })

  return { snapshot }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "@redcode/SessionExecutionGraph",
) {}

export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Session.node, SessionStore.node, Job.node, PersistentPty.node],
})
