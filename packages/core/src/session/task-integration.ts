export * as SessionTaskIntegration from "./task-integration.js"

import type { SessionTodo } from "@opencode/schema/session-todo"
import type { SessionTaskAssignments } from "./task-assignments.js"
import type { SessionTaskFacts } from "./task-facts.js"
import { SessionTaskGraph } from "./task-graph.js"

/** Contract freshness only. The host checks actual Git revisions when preparing or applying. */
export function issues(
  task: SessionTodo.Info,
  tasks: ReadonlyArray<SessionTodo.Info>,
  assignments: ReadonlyArray<SessionTaskAssignments.Assignment>,
  integration = task.integration,
) {
  if (!integration) return []
  const required = task.dependencies ?? []
  return [
    ...(integration.fingerprint !== SessionTaskGraph.fingerprint(task, tasks)
      ? ["The integration task or its accepted inputs changed; prepare a new candidate"]
      : []),
    ...(required.length !== integration.sources.length ||
    new Set(integration.sources.map((source) => source.taskID)).size !== required.length ||
    required.some((id) => !integration.sources.some((source) => source.taskID === id))
      ? ["The candidate does not cover exactly the required tasks"]
      : []),
    ...integration.sources.flatMap((source) => {
      const latest = assignments
        .filter((entry) => entry.taskID === source.taskID)
        .toSorted((a, b) => a.assigned - b.assigned)
        .at(-1)
      if (
        !latest ||
        !latest.current ||
        latest.state !== "settled" ||
        latest.workspaceID ||
        latest.sessionID !== source.sessionID ||
        latest.promptID !== source.promptID ||
        latest.fingerprint !== source.fingerprint ||
        latest.directory !== source.sessionDirectory
      )
        return [`Source task ${source.taskID} changed or has unsettled work; prepare a new candidate`]
      return []
    }),
  ]
}

export function completionError(
  task: SessionTodo.Info,
  tasks: ReadonlyArray<SessionTodo.Info>,
  assignments: ReadonlyArray<SessionTaskAssignments.Assignment>,
  results: ReadonlyArray<SessionTaskFacts.Result>,
) {
  if (!task.integration) return
  const stale = issues(task, tasks, assignments)[0]
  if (stale) return stale
  const proof = results.find(
    (entry) => entry.callID === task.evidence?.callID && entry.messageID === task.evidence?.messageID,
  )
  if (!proof?.successful || proof.kind !== "verification" || proof.completed <= task.integration.preparedAt)
    return `Task ${task.id} needs a fresh verification after its integration candidate was prepared`
}
