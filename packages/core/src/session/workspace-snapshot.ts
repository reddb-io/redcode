export * as SessionWorkspaceSnapshot from "./workspace-snapshot.js"

import { Context, Effect, Layer } from "effect"
import { Redact } from "@opencode/util/redact"
import { SessionTodo } from "@opencode/schema/session-todo"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Session } from "../session.js"
import { SessionGoal } from "./goal.js"
import { SessionSchema } from "./schema.js"
import { SessionTodoStore } from "./todo-store.js"

/**
 * Deterministic workspace facts, computed in code rather than asked of the model: the files a
 * session changed, structured execution evidence, the task and goal state, and a one-line summary
 * of where the session is heading. Bounded per section and redacted like other evaluation sources.
 */

const FILES = 24
const TASKS = 5
const OBJECTIVE = 400
const STATUSES = ["pending", "in_progress", "blocked", "completed", "cancelled"] as const

export interface Todos {
  readonly counts: Readonly<Record<string, number>>
  readonly working: ReadonlyArray<{ readonly key: string; readonly label: string }>
  readonly blocked: ReadonlyArray<{ readonly key: string; readonly label: string }>
  readonly next: ReadonlyArray<{ readonly key: string; readonly label: string }>
}

export interface Goal {
  readonly status: string
  readonly stopAfter?: string
  readonly objective: string
}

export interface Snapshot {
  /** Project-relative paths the session changed, redacted and bounded. */
  readonly files: readonly string[]
  readonly todos: Todos
  readonly goal: Goal | undefined
  /** The "where are we heading" one-liner, composed from the facts above. */
  readonly heading: string
}

/** Task counts by status; every known status present, zero when none. Historical snapshots may
 *  carry other status values, so they are counted under their own key instead of dropped. */
export const todoCounts = (all: readonly SessionTodo.Info[]): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {}
  for (const status of STATUSES) counts[status] = 0
  for (const todo of all) counts[todo.status] = (counts[todo.status] ?? 0) + 1
  return counts
}

/** The facts' one-line summary: what changed, what is being worked on, what blocks, where the goal stands. */
export const heading = (input: {
  readonly files: ReadonlyArray<string>
  readonly todos: Todos
  readonly goal: Goal | undefined
}): string => {
  const parts: string[] = []
  if (input.files.length)
    parts.push(`${input.files.length} ${input.files.length === 1 ? "file" : "files"} changed`)
  if (input.todos.working.length) parts.push(`working on ${input.todos.working.map((task) => task.label).join(", ")}`)
  if (input.todos.blocked.length) parts.push(`${input.todos.blocked.length} blocked`)
  if (input.goal) parts.push(`goal ${input.goal.status}${input.goal.stopAfter ? ` (${input.goal.stopAfter})` : ""}`)
  return parts.length ? parts.join(" · ") : "no workspace changes recorded yet"
}

const entries = (all: readonly SessionTodo.Info[], status: string) =>
  all
    .filter((todo) => todo.status === status)
    .slice(0, TASKS)
    .map((todo) => ({ key: todo.id ?? "", label: Redact.redact(SessionTodo.label(todo)) }))

/** Deduplicates, redacts and bounds the changed-file paths. */
export const boundFiles = (paths: readonly string[], limit = FILES) =>
  [...new Set(paths)].map((path) => Redact.redact(path)).slice(0, limit)

const make = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const todos = yield* SessionTodoStore.Service
  const goals = yield* SessionGoal.Service

  /** Changed project-relative paths for the session's current location segment. A turn range that
   *  spans a location switch diffs wrongly, so it yields no fact instead of a wrong one. */
  const changed = Effect.fn("SessionWorkspaceSnapshot.changed")(function* (sessionID: SessionSchema.ID) {
    const diffs = yield* sessions
      .diff({ sessionID, scope: "session", context: 1 })
      .pipe(Effect.orElseSucceed(() => []))
    return boundFiles(diffs.map((diff) => diff.file))
  })

  const snapshot = Effect.fn("SessionWorkspaceSnapshot.snapshot")(function* (
    sessionID: SessionSchema.ID,
    options?: { readonly limit?: number },
  ) {
    const session = yield* sessions.get(sessionID).pipe(Effect.orElseSucceed(() => undefined))
    if (!session) return undefined
    const limit = options?.limit ?? FILES
    const files = (yield* changed(sessionID)).slice(0, limit)
    const all = yield* todos.get(sessionID).pipe(Effect.orElseSucceed(() => []))
    const goal = yield* goals.get(sessionID).pipe(Effect.orElseSucceed(() => undefined))
    const gathered: Todos = {
      counts: todoCounts(all),
      working: entries(all, "in_progress"),
      blocked: entries(all, "blocked"),
      next: entries(all, "pending"),
    }
    const facts: Goal | undefined = goal
      ? {
          status: goal.status,
          ...(goal.stopAfter ? { stopAfter: goal.stopAfter } : {}),
          objective: Redact.redact(goal.objective.slice(0, OBJECTIVE)),
        }
      : undefined
    return {
      files,
      todos: gathered,
      goal: facts,
      heading: heading({ files, todos: gathered, goal: facts }),
    } satisfies Snapshot
  })

  return { snapshot }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/SessionWorkspaceSnapshot") {}

export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Session.node, SessionTodoStore.node, SessionGoal.node],
})
