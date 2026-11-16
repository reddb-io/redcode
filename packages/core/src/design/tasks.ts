export * as DesignTasks from "./tasks.js"

import { Effect } from "effect"
import { Bus } from "../bus.js"
import { SessionTodo } from "@opencode/schema/session-todo"
import { SessionTodoStore } from "../session/todo-store.js"
import { DesignStore } from "./store.js"
import { DesignRounds } from "./rounds.js"
import type { SessionSchema } from "../session/schema.js"

/**
 * Admit review notes to the existing task ledger once, without resetting earlier work or outcomes.
 *
 * Admission of a review must not fail because of task bookkeeping: the note ledger is the authority
 * for review outcomes and the round continues without these tasks. Any failure is logged and
 * swallowed, so a task write never stops the agent from working the round.
 */
export const admit = Effect.fn("DesignTasks.admit")(function* (sessionID: SessionSchema.ID, feedbackID: string) {
  const designs = yield* DesignStore.Service
  const todos = yield* SessionTodoStore.Service
  const bus = yield* Bus.Service
  yield* Effect.gen(function* () {
    const current = yield* todos.get(sessionID)
    const documents = yield* designs.list(sessionID)
    const pending = documents.flatMap((document) =>
      document.ended
        ? []
        : DesignRounds.open(document).flatMap((note) => {
            const key = `design-feedback:${document.id}:${note.index}`
            // One task per note, however many times the same review is delivered.
            if (
              note.feedback !== feedbackID ||
              current.some((task) => task.source?.id === feedbackID && task.source.key === key)
            )
              return []
            return [{ document, note, key }]
          }),
    )
    if (!pending.length) return
    const written = yield* todos.write({
      sessionID,
      phase: "design",
      origin: {
        type: "request",
        id: feedbackID,
        quote: pending.map(({ note }) => note.item.text).join("\n"),
        created: Math.min(...pending.map(({ note }) => note.updated)),
      },
      todos: pending.map(({ document, note, key }) => ({
        planKey: key,
        title: SessionTodo.label({ content: note.item.text }),
        content: `Design ${document.name}, feedback ${feedbackID} #${note.index}: ${note.item.text}`,
        criterion: note.item.text,
        requirement: note.item.text,
        status: "pending",
        priority: "medium",
      })),
    })
    yield* bus.publish(SessionTodo.Event.Updated, { sessionID, todos: written.todos })
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Design review note tasks were not admitted", { sessionID, feedbackID, cause }),
    ),
  )
})
