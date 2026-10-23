export * as SessionTaskGraph from "./task-graph.js"

import type { SessionTodo } from "@opencode/schema/session-todo"
import { SessionTaskFacts } from "./task-facts.js"

/** Task edges name activities in the same session; cancellation never satisfies a prerequisite. */
export function waiting(tasks: ReadonlyArray<SessionTodo.Info>, task: SessionTodo.Info) {
  return (task.dependencies ?? []).filter((id) => {
    const dependency = tasks.find((entry) => entry.id === id)
    return dependency?.status !== "completed" || !dependency.evidence
  })
}

export function validate(tasks: ReadonlyArray<SessionTodo.Info>) {
  const indexed = new Map(tasks.map((task) => [task.id, task]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (task: SessionTodo.Info): string | undefined => {
    if (!task.id || visited.has(task.id)) return
    if (visiting.has(task.id)) return `Task dependencies contain a cycle at ${task.id}`
    visiting.add(task.id)
    const dependencies = task.dependencies ?? []
    if (new Set(dependencies).size !== dependencies.length) return `Duplicate dependencies for task ${task.id}`
    for (const id of dependencies) {
      const dependency = indexed.get(id)
      if (!dependency) return `Unknown dependency ${id} for task ${task.id}`
      if ((dependency.phase ?? "build") !== (task.phase ?? "build"))
        return `Task ${task.id} cannot depend on a task from another phase: ${id}`
      const problem = visit(dependency)
      if (problem) return problem
    }
    visiting.delete(task.id)
    visited.add(task.id)
  }
  return tasks.map(visit).find((problem) => problem !== undefined)
}

/** Execution/status updates do not change the contract a child was asked to deliver. */
export function fingerprint(task: SessionTodo.Info, tasks: ReadonlyArray<SessionTodo.Info>) {
  return SessionTaskFacts.hash({
    content: task.content,
    criterion: task.criterion,
    source: task.source,
    phase: task.phase ?? "build",
    dependencies: (task.dependencies ?? []).map((id) => {
      const dependency = tasks.find((entry) => entry.id === id)
      return { id, hash: dependency ? proof(dependency) : undefined }
    }),
  })
}

export function proof(task: SessionTodo.Info) {
  return SessionTaskFacts.hash({
    content: task.content,
    criterion: task.criterion,
    source: task.source,
    evidence: task.evidence,
    inputs: task.inputs,
    integration: task.integration,
  })
}

export function stale(tasks: ReadonlyArray<SessionTodo.Info>, task: SessionTodo.Info) {
  if (!task.dependencies?.length) return false
  return (
    waiting(tasks, task).length > 0 ||
    (task.dependencies ?? []).some((id) => {
      const dependency = tasks.find((entry) => entry.id === id)
      return !dependency || task.inputs?.find((input) => input.id === id)?.hash !== proof(dependency)
    })
  )
}

export function snapshot(tasks: ReadonlyArray<SessionTodo.Info>) {
  return tasks.map((task) => ({
    id: task.id,
    revision: task.revision,
    dependencies: task.dependencies ?? [],
    waitingFor: waiting(tasks, task),
    ready: (task.status === "pending" || task.status === "in_progress") && waiting(tasks, task).length === 0,
  }))
}

/** Reopen the entire dependent closure in one mutation, before any successor can be promoted. */
export function invalidated(tasks: ReadonlyArray<SessionTodo.Info>, initial: ReadonlyArray<string>) {
  const ids = new Set(initial)
  const visited = new Map<SessionTodo.Info, boolean>()
  const visit = (task: SessionTodo.Info): boolean => {
    if (task.id && ids.has(task.id)) return true
    if (visited.has(task)) return visited.get(task)!
    if (
      !(task.dependencies ?? []).some((id) => {
        const dependency = tasks.find((entry) => entry.id === id)
        return dependency !== undefined && visit(dependency)
      })
    ) {
      visited.set(task, false)
      return false
    }
    if (task.id) ids.add(task.id)
    return true
  }
  tasks.forEach(visit)
  return ids
}

/** Capture accepted inputs in dependency order, including chains completed in one write. */
export function capture<T extends SessionTodo.Info>(tasks: ReadonlyArray<T>) {
  const captured = new Map<string, T>()
  const visit = (task: T): T => {
    if (task.id && captured.has(task.id)) return captured.get(task.id)!
    const dependencies = (task.dependencies ?? []).map((id) => visit(tasks.find((entry) => entry.id === id)!))
    const result =
      task.status === "completed" && dependencies.length && !task.inputs
        ? { ...task, inputs: dependencies.map((dependency) => ({ id: dependency.id!, hash: proof(dependency) })) }
        : task
    if (task.id) captured.set(task.id, result)
    return result
  }
  return tasks.map(visit)
}
