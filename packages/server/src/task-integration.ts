export * as TaskIntegration from "./task-integration.js"

import path from "node:path"
import { realpath } from "node:fs/promises"
import { Bus } from "@opencode/core/bus"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTodoStore } from "@opencode/core/session/todo-store"
import { SessionTaskAssignments } from "@opencode/core/session/task-assignments"
import { SessionTaskFacts } from "@opencode/core/session/task-facts"
import { SessionTaskGraph } from "@opencode/core/session/task-graph"
import { SessionTaskIntegration } from "@opencode/core/session/task-integration"
import { SessionTodoEvidence } from "@opencode/core/session/todo-evidence"
import { SessionTaskReconciliation } from "@opencode/core/session/task-reconciliation"
import { Worktree } from "@opencode/core/worktree"
import { Session } from "@opencode/schema/session"
import { SessionTodo } from "@opencode/schema/session-todo"
import { ServerAccess } from "@opencode/protocol/server-access"
import { AbsolutePath } from "@opencode/schema/schema"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Flock } from "@opencode/util/flock"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer } from "effect"
import { applyIntegration, inspectWorktree, prepareIntegration, resolveWorktreeInventory } from "./worktree-review"

const make = Effect.gen(function* () {
  const sessions = yield* SessionStore.Service
  const todos = yield* SessionTodoStore.Service
  const reconciliation = yield* SessionTaskReconciliation.Service
  const worktrees = yield* Worktree.Service
  const assignments = yield* SessionTaskAssignments.Service
  const facts = yield* SessionTaskFacts.Service
  const global = yield* Global.Service
  const bus = yield* Bus.Service

  const prepare = Effect.fn("TaskIntegration.prepare")(function* (
    parent: Session.Info,
    taskID: string,
    input: SessionTodo.PrepareIntegrationInput,
  ) {
    const principal = yield* ServerAccess.Current
    if (principal && principal.access.ownerRole !== "admin")
      return yield* new SessionTodo.Error({
        message: "Use the host's trusted project connection for checkout operations",
      })
    const report = yield* reconciliation.inspect(parent.id, taskID, input.revision)
    if (report.task.status !== "pending" && report.task.status !== "in_progress")
      return yield* new SessionTodo.Error({ message: "Reopen the integration task before preparing a candidate" })
    if (report.inputs.length > 32)
      return yield* new SessionTodo.Error({ message: "One integration candidate supports at most 32 required tasks" })
    if (!report.inputs.length || !report.executionSettled || !report.acceptanceReady)
      return yield* new SessionTodo.Error({
        message: "Accept and settle every prerequisite before preparing integration",
      })
    if (parent.location.workspaceID)
      return yield* new SessionTodo.Error({
        message: "Task integration currently requires local worktrees on this host",
      })
    const inventory = yield* worktrees.list({ projectID: parent.projectID }).pipe(
      Effect.mapError(
        () => new SessionTodo.Error({ message: "The session project has no recorded checkout inventory" }),
      ),
      Effect.flatMap((inventory) =>
        Effect.tryPromise({ try: () => resolveWorktreeInventory(inventory), catch: failure }),
      ),
    )
    const sources = yield* Effect.forEach(report.inputs, (required) =>
      Effect.gen(function* () {
        const contribution = required.contributions.at(-1)
        if (!contribution?.current || contribution.execution !== "succeeded")
          return yield* new SessionTodo.Error({
            message: `Task ${required.task.id} needs a current, successful tracked contribution`,
          })
        const child = yield* sessions.get(contribution.sessionID)
        if (!child || child.projectID !== parent.projectID || child.location.workspaceID)
          return yield* new SessionTodo.Error({
            message: "All contributing sessions must belong to this local project",
          })
        const review = yield* Effect.tryPromise({
          try: async () => {
            const directory = await realpath(child.location.directory)
            const checkout = inventory
              .toSorted((a, b) => b.directory.length - a.directory.length)
              .find((entry) => {
                const relative = path.relative(entry.directory, directory)
                return (
                  relative === "" ||
                  (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
                )
              })
            if (!checkout || checkout.strategy !== "git")
              throw new Error(`Task ${required.task.id} has no managed Git source checkout`)
            return inspectWorktree(
              { projectID: parent.projectID, directory: checkout.directory, target: input.target },
              inventory,
            )
          },
          catch: failure,
        })
        return {
          taskID: required.task.id!,
          taskRevision: contribution.taskRevision,
          fingerprint: contribution.fingerprint,
          sessionID: contribution.sessionID,
          promptID: contribution.promptID,
          sessionDirectory: AbsolutePath.make(child.location.directory),
          directory: review.directory,
          head: review.head,
        } satisfies SessionTodo.IntegrationSource
      }),
    )
    const unique = [
      ...new Map(
        sources.map((source) => [source.directory, { directory: source.directory, head: source.head }]),
      ).values(),
    ]
    if (sources.some((source) => unique.find((entry) => entry.directory === source.directory)?.head !== source.head))
      return yield* new SessionTodo.Error({
        message: "A source revision changed while collecting inputs; prepare again",
      })
    const candidate = yield* Effect.tryPromise({
      try: () =>
        prepareIntegration(
          { projectID: parent.projectID, target: input.target, targetHead: input.targetHead, sources: unique },
          inventory,
        ),
      catch: failure,
    })
    if (candidate.status !== "ready") return { task: report.task, candidate }
    const latest = yield* reconciliation.inspect(parent.id, taskID, input.revision)
    if (!latest.executionSettled || !latest.acceptanceReady)
      return yield* new SessionTodo.Error({
        message: "Prerequisite acceptance changed during preparation; inspect and prepare again",
      })
    const task = yield* todos.bindIntegration({
      sessionID: parent.id,
      taskID,
      revision: input.revision,
      integration: {
        fingerprint: report.fingerprint,
        preparedAt: Date.now(),
        target: candidate.target,
        targetHead: candidate.targetHead,
        head: candidate.head!,
        tree: candidate.tree!,
        sources,
      },
    })
    return { task, candidate } satisfies SessionTodo.IntegrationPreparation
  })
  const apply = Effect.fn("TaskIntegration.apply")(function* (
    parent: Session.Info,
    taskID: string,
    input: SessionTodo.ApplyIntegrationInput,
  ) {
    const principal = yield* ServerAccess.Current
    if (principal && principal.access.ownerRole !== "admin")
      return yield* new SessionTodo.Error({
        message: "Use the host's trusted project connection for checkout operations",
      })
    if (parent.location.workspaceID)
      return yield* new SessionTodo.Error({
        message: "Task integration currently requires local worktrees on this host",
      })
    // Keep the handler and lock alive until the Git child has settled, even if its HTTP client disconnects.
    return yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () =>
              Flock.acquire(`task-integration:${parent.projectID}`, {
                dir: path.join(global.state, "task-integration-locks"),
                timeoutMs: 2_000,
              }),
            catch: failure,
          }),
          (lock) => Effect.promise(() => lock.release()),
        )
        return yield* assignments.withMutation(
          Effect.gen(function* () {
            const previous = yield* todos.integrationApplication(parent.id, taskID, input.requestID)
            if (previous && (previous.taskRevision !== input.revision || previous.head !== input.candidateHead))
              return yield* new SessionTodo.Error({
                message: "Application request identity was already used for another revision",
              })
            if (previous?.state === "applied") return previous
            const report = yield* reconciliation.inspect(parent.id, taskID, previous ? undefined : input.revision)
            const binding = report.task.integration
            if (!binding)
              return yield* new SessionTodo.Error({ message: "Prepare and verify an integration candidate first" })
            const inventory = yield* worktrees
              .list({ projectID: parent.projectID })
              .pipe(
                Effect.mapError(
                  () => new SessionTodo.Error({ message: "The session project has no recorded checkout inventory" }),
                ),
              )
            const observe = (application: SessionTodo.IntegrationApplication) =>
              Effect.tryPromise({
                try: () =>
                  inspectWorktree(
                    { projectID: parent.projectID, directory: application.target, target: application.target },
                    inventory,
                  ),
                catch: failure,
              })
            if (previous) {
              // Never replay an admitted mutation. Recovery observes only its original target.
              const target = yield* observe(previous)
              if (target.head !== previous.head || target.dirty) return previous
              const applied = { ...previous, state: "applied" as const, completed: Date.now() }
              yield* todos.recordIntegrationApplication({
                sessionID: parent.id,
                taskID,
                revision: report.task.revision!,
                application: applied,
              })
              return applied
            }
            if (report.task.integrationApplication?.state === "pending")
              return yield* new SessionTodo.Error({
                message: "Reconcile the pending application using its original request identity",
              })
            const tasks = yield* todos.get(parent.id)
            const observed = yield* facts.load(parent.id)
            const delegated = yield* assignments.snapshot(parent.id, tasks)
            const proof = observed.results.find(
              (entry) =>
                entry.callID === report.task.evidence?.callID && entry.messageID === report.task.evidence?.messageID,
            )
            if (
              report.task.status !== "completed" ||
              !report.acceptanceReady ||
              !report.executionSettled ||
              !report.integration?.contractCurrent ||
              SessionTaskGraph.stale(tasks, report.task) ||
              SessionTaskAssignments.completionError(delegated, report.task, observed.results) ||
              SessionTaskIntegration.completionError(report.task, tasks, delegated, observed.results) ||
              !proof?.successful ||
              proof.hash !== report.task.evidence?.hash ||
              SessionTodoEvidence.invalidating(observed.results, proof)
            )
              return yield* new SessionTodo.Error({
                message: "Accept the current candidate with fresh verification before applying it",
              })
            if (binding.head !== input.candidateHead)
              return yield* new SessionTodo.Error({ message: "Apply exactly the accepted candidate SHA" })
            const gitInput = {
              projectID: parent.projectID,
              target: binding.target,
              targetHead: binding.targetHead,
              candidateHead: binding.head,
              sources: [
                ...new Map(
                  binding.sources.map((source) => [
                    source.directory,
                    { directory: source.directory, head: source.head },
                  ]),
                ).values(),
              ],
            }
            const candidate = yield* Effect.tryPromise({
              try: () => prepareIntegration(gitInput, inventory),
              catch: failure,
            })
            if (candidate.status !== "ready" || candidate.head !== binding.head || candidate.tree !== binding.tree)
              return yield* new SessionTodo.Error({
                message: "The accepted candidate changed; prepare and verify again",
              })
            const application: SessionTodo.IntegrationApplication = {
              requestID: input.requestID,
              taskRevision: input.revision,
              fingerprint: binding.fingerprint,
              target: binding.target,
              targetHead: binding.targetHead,
              head: binding.head,
              tree: binding.tree,
              started: Date.now(),
              state: "pending",
            }
            const admitted = yield* todos.recordIntegrationApplication({
              sessionID: parent.id,
              taskID,
              revision: input.revision,
              application,
            })
            yield* bus.publish(SessionTodo.Event.Updated, { sessionID: parent.id, todos: yield* todos.get(parent.id) })
            // Errors after admission leave a durable pending record. A retry only observes Git.
            yield* Effect.tryPromise({ try: () => applyIntegration(gitInput, inventory), catch: failure })
            const target = yield* observe(application)
            if (target.head !== application.head || target.dirty) return application
            const applied = { ...application, state: "applied" as const, completed: Date.now() }
            yield* todos.recordIntegrationApplication({
              sessionID: parent.id,
              taskID,
              revision: admitted.revision!,
              application: applied,
            })
            return applied
          }),
        )
      }),
    ).pipe(Effect.uninterruptible)
  })
  return { prepare, apply }
})

function failure(error: unknown) {
  return new SessionTodo.Error({ message: error instanceof Error ? error.message : "Task integration failed" })
}

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/TaskIntegration") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    SessionStore.node,
    SessionTodoStore.node,
    SessionTaskReconciliation.node,
    Worktree.node,
    SessionTaskAssignments.node,
    SessionTaskFacts.node,
    Global.node,
    Bus.node,
  ],
})
