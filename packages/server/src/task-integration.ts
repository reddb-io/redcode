export * as TaskIntegration from "./task-integration.js"

import path from "node:path"
import { realpath } from "node:fs/promises"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTodoStore } from "@opencode/core/session/todo-store"
import { SessionTaskReconciliation } from "@opencode/core/session/task-reconciliation"
import { Worktree } from "@opencode/core/worktree"
import { Session } from "@opencode/schema/session"
import { SessionTodo } from "@opencode/schema/session-todo"
import { ServerAccess } from "@opencode/protocol/server-access"
import { AbsolutePath } from "@opencode/schema/schema"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { inspectWorktree, prepareIntegration } from "./worktree-review"

const make = Effect.gen(function* () {
  const sessions = yield* SessionStore.Service
  const todos = yield* SessionTodoStore.Service
  const reconciliation = yield* SessionTaskReconciliation.Service
  const worktrees = yield* Worktree.Service

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
    const inventory = yield* worktrees
      .list({ projectID: parent.projectID })
      .pipe(
        Effect.mapError(
          () => new SessionTodo.Error({ message: "The session project has no recorded checkout inventory" }),
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
  return { prepare }
})

function failure(error: unknown) {
  return new SessionTodo.Error({ message: error instanceof Error ? error.message : "Task integration failed" })
}

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/TaskIntegration") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [SessionStore.node, SessionTodoStore.node, SessionTaskReconciliation.node, Worktree.node],
})
