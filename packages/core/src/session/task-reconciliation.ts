export * as SessionTaskReconciliation from "./task-reconciliation.js"

import { SessionTodo } from "@opencode/schema/session-todo"
import { SubagentReview } from "@opencode/schema/subagent-review"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { Job } from "../job.js"
import { SubagentCompletion } from "./subagent-completion.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"
import { SessionTaskAssignments } from "./task-assignments.js"
import { SessionTaskFacts } from "./task-facts.js"
import { SessionTaskGraph } from "./task-graph.js"
import { SessionTaskIntegration } from "./task-integration.js"
import { SessionTodoEvidence } from "./todo-evidence.js"
import { SessionTodoStore } from "./todo-store.js"

export const LIMITS = { response: 4_000, checks: 8, paths: 128 }

const make = Effect.gen(function* () {
  const todos = yield* SessionTodoStore.Service
  const assignments = yield* SessionTaskAssignments.Service
  const facts = yield* SessionTaskFacts.Service
  const store = yield* SessionStore.Service
  const jobs = yield* Job.Service

  const inspect = Effect.fn("SessionTaskReconciliation.inspect")(function* (
    sessionID: SessionSchema.ID,
    taskID: string,
    revision?: number,
  ) {
    const tasks = yield* todos.get(sessionID)
    const task = tasks.find((task) => task.id === taskID)
    if (!task) return yield* new SessionTodo.Error({ message: `Unknown task ${taskID} in this session` })
    if (revision !== undefined && task.revision !== revision)
      return yield* new SessionTodo.Error({
        message: `Task ${taskID} changed; its current revision is ${task.revision}`,
      })
    const snapshot = yield* assignments.inspect(sessionID, tasks)
    const delegated = snapshot.assignments
    const observed = yield* facts.load(sessionID)
    const invalid = SessionTaskGraph.invalidated(
      tasks,
      tasks
        .filter((task) => {
          if (task.status !== "completed") return false
          if (
            SessionTaskGraph.stale(tasks, task) ||
            SessionTaskAssignments.completionError(delegated, task, observed.results) ||
            SessionTaskIntegration.completionError(task, tasks, delegated, observed.results)
          )
            return true
          if (!task.evidence) return true
          const proof = observed.results.find(
            (entry) => entry.callID === task.evidence?.callID && entry.messageID === task.evidence.messageID,
          )
          return (
            !proof?.successful ||
            proof.hash !== task.evidence.hash ||
            SessionTodoEvidence.invalidating(observed.results, proof) !== undefined
          )
        })
        .flatMap((task) => (task.id ? [task.id] : [])),
    )
    const inputs = yield* Effect.forEach(task.dependencies ?? [], (id) =>
      Effect.gen(function* () {
        const input = tasks.find((task) => task.id === id)
        if (!input) return yield* new SessionTodo.Error({ message: `Missing prerequisite ${id} for task ${taskID}` })
        const related = delegated.filter((entry) => entry.taskID === id).toSorted((a, b) => a.assigned - b.assigned)
        const contributions = yield* Effect.forEach(related, (assignment) =>
          Effect.gen(function* () {
            const child = yield* store.get(assignment.sessionID)
            const brief = SubagentReview.read(child?.metadata)
            if (brief?.task?.promptID !== assignment.promptID)
              return yield* new SessionTodo.Error({
                message: `Delegation ${assignment.sessionID} changed while collecting results; inspect it again`,
              })
            const completion = brief.completion?.promptID === assignment.promptID ? brief.completion : undefined
            const job = yield* jobs.get(assignment.sessionID)
            const messages = yield* store.messages({
              sessionID: assignment.sessionID,
              order: "asc",
              cursor: { id: SessionMessage.ID.make(assignment.promptID), direction: "next" },
            })
            const response = messages.findLast(
              (message) =>
                message.type === "assistant" &&
                message.time.completed !== undefined &&
                message.content.some((part) => part.type === "text" && part.text.length > 0),
            )
            const text = response ? SubagentCompletion.text(response) : undefined
            const childFacts = yield* facts.load(assignment.sessionID, { descendants: true })
            const messageIDs = new Set(messages.map((message) => message.id))
            const results = childFacts.results.filter((entry) =>
              entry.sessionID === assignment.sessionID
                ? messageIDs.has(SessionMessage.ID.make(entry.messageID))
                : entry.completed >= assignment.assigned,
            )
            const checks = results.filter((entry) => entry.kind === "verification")
            const edits = results.filter(
              (entry) => entry.kind === "edit" && !entry.abandoned && (entry.successful || !entry.settled),
            )
            const paths = [...new Set(edits.flatMap((entry) => entry.paths))].toSorted()
            return {
              sessionID: assignment.sessionID,
              taskRevision: assignment.revision,
              promptID: assignment.promptID,
              fingerprint: assignment.fingerprint,
              current: assignment.current,
              context: assignment.context,
              execution:
                assignment.state === "running"
                  ? ("running" as const)
                  : completion?.status === "error" ||
                      (!completion && (job?.status === "error" || assignment.outcome === "failed"))
                    ? ("failed" as const)
                    : completion?.status === "cancelled" ||
                        (!completion && (job?.status === "cancelled" || assignment.outcome === "interrupted"))
                      ? ("interrupted" as const)
                      : completion?.status === "completed" ||
                          job?.status === "completed" ||
                          assignment.outcome === "succeeded"
                        ? ("succeeded" as const)
                        : ("unknown" as const),
              ...(brief?.result ? { review: brief.result } : {}),
              ...(completion ? { completion } : {}),
              ...(response && text !== undefined
                ? {
                    response: {
                      messageID: response.id,
                      text: text.slice(0, LIMITS.response),
                      hash: SessionTaskFacts.hash(text),
                      bytes: Buffer.byteLength(text),
                      truncated: text.length > LIMITS.response,
                    },
                  }
                : {}),
              checks: checks.slice(-LIMITS.checks).map((entry) => {
                const invalidated = SessionTodoEvidence.invalidating(childFacts.results, entry)
                return {
                  callID: entry.callID,
                  messageID: entry.messageID,
                  tool: entry.tool,
                  hash: entry.hash,
                  completed: entry.completed,
                  successful: entry.successful,
                  settled: entry.settled,
                  fresh: entry.successful && entry.settled && !invalidated,
                  ...(invalidated
                    ? {
                        invalidatedBy: {
                          sessionID: invalidated.sessionID,
                          messageID: invalidated.messageID,
                          callID: invalidated.callID,
                        },
                      }
                    : {}),
                }
              }),
              omittedChecks: Math.max(0, checks.length - LIMITS.checks),
              changedPaths: paths.slice(0, LIMITS.paths),
              omittedPaths: Math.max(0, paths.length - LIMITS.paths),
              unknownWriteScope:
                edits.some((entry) => entry.paths.length === 0) ||
                results.some(
                  (entry) =>
                    (entry.tool === "shell" || entry.tool === "bash") && !SessionTaskFacts.readOnly(entry.input),
                ),
            } satisfies SessionTodo.Contribution
          }),
        )
        const acceptance = acceptanceOf(input, invalid)
        const latest = contributions.at(-1)
        return {
          task: input,
          acceptance,
          contributions,
          issues: [
            ...(acceptance === "accepted"
              ? []
              : [`Prerequisite ${id} is ${acceptance}; parent acceptance is required`]),
            ...(related.some((entry) => entry.state === "running") ? ["Delegated work is still running"] : []),
            ...(latest && !latest.current
              ? ["The latest delegation uses an older task contract or shared objective"]
              : []),
            ...(latest && latest.execution !== "succeeded" ? [`Latest execution outcome: ${latest.execution}`] : []),
            ...(latest && latest.review?.decision !== "verified"
              ? [`Result review: ${latest.review?.decision ?? "unverified"}`]
              : []),
            ...(contributions.some((entry) => entry.unknownWriteScope || entry.omittedPaths > 0)
              ? ["Changed-file coverage is incomplete; inspect source sessions before integrating"]
              : []),
          ],
        } satisfies SessionTodo.ReconciliationInput
      }),
    )
    const paths = [
      ...new Set(inputs.flatMap((input) => input.contributions.flatMap((entry) => entry.changedPaths))),
    ].toSorted()
    const overlaps = paths.flatMap((path) => {
      const taskIDs = inputs
        .filter((input) => input.contributions.some((entry) => entry.changedPaths.includes(path)))
        .flatMap((input) => (input.task.id ? [input.task.id] : []))
      return taskIDs.length > 1 ? [{ path, taskIDs }] : []
    })
    const integrationIssues = SessionTaskIntegration.issues(task, tasks, delegated)
    const executionSettled = inputs.every((input) =>
      input.contributions.length
        ? input.contributions.every((entry) => entry.execution !== "running")
        : input.acceptance === "accepted",
    )
    const accepted = inputs
      .filter(
        (input) =>
          input.acceptance === "accepted" && input.contributions.every((entry) => entry.execution !== "running"),
      )
      .map((input) => input.task.id!)
    return {
      sessionID,
      task,
      acceptance: acceptanceOf(task, invalid),
      fingerprint: SessionTaskGraph.fingerprint(task, tasks),
      observedAt: Date.now(),
      executionSettled,
      acceptanceReady: inputs.every((input) => input.acceptance === "accepted"),
      convergence: {
        required: task.dependencies ?? [],
        accepted,
        waitingFor: (task.dependencies ?? []).filter((id) => !accepted.includes(id)),
        ready: executionSettled && accepted.length === inputs.length,
      },
      context: snapshot.context,
      inputs,
      ...(task.integration
        ? {
            integration: {
              binding: task.integration,
              contractCurrent: integrationIssues.length === 0,
              issues: integrationIssues,
            },
          }
        : {}),
      overlaps,
    } satisfies SessionTodo.Reconciliation
  })
  return { inspect }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "@redcode/SessionTaskReconciliation",
) {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [SessionTodoStore.node, SessionTaskAssignments.node, SessionTaskFacts.node, SessionStore.node, Job.node],
})

function acceptanceOf(task: SessionTodo.Info, invalid: ReadonlySet<string>) {
  if (task.status === "completed") {
    if (!task.evidence) return "unverified" as const
    return task.id && invalid.has(task.id) ? ("stale" as const) : ("accepted" as const)
  }
  if (task.status === "cancelled") return "cancelled" as const
  if (task.status === "blocked") return "blocked" as const
  return "pending" as const
}
