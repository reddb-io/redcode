export * as SessionTodo from "./todo"

import { Context, Effect, Layer } from "effect"
import { SessionTodo } from "@reddb-io/redcode-schema/session-todo"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { SessionSchema } from "./schema"
import { SessionTodoStore } from "./todo-store"

export const Input = SessionTodo.Input
export type Input = SessionTodo.Input
export const Error = SessionTodo.Error
export type Error = SessionTodo.Error
export const Info = SessionTodo.Info
export type Info = typeof Info.Type
export const Event = SessionTodo.Event
export const guidance =
  "For multi-step work, use todowrite to capture EVERY requested item, including verification, then begin real work in the same turn. Update tasks as work happens using their id and revision; omitted tasks are preserved. Complete only verified work. Block only on a concrete obstacle, keep working on independent tasks, and cancel only work removed from scope with a reason. A blocked task is not complete. Skip task tracking for simple or informational requests."

export function active(todos: ReadonlyArray<Info>) {
  return todos.filter((todo) => todo.status !== "completed" && todo.status !== "cancelled")
}

export function reminder(todos: ReadonlyArray<Info>) {
  const remaining = active(todos).filter((todo) => todo.status !== "blocked")
  if (remaining.length === 0) return
  return [
    "You still have unfinished todo items. Continue working instead of giving a final response.",
    ...remaining.map((todo) => `- [${todo.status}] ${todo.content}`),
    "Execute the next actionable task now. Verify before completing; record a concrete blocker or scope-change reason instead of silently cancelling work.",
  ].join("\n")
}

export function blocker(todos: ReadonlyArray<Info>) {
  const remaining = active(todos)
  if (!remaining.length || remaining.some((todo) => todo.status !== "blocked")) return
  return remaining
    .map((todo) => `${todo.content}: ${todo.reason ?? "Inspect and reconcile this blocked task"}`)
    .join("\n")
}

export const limitReason =
  "Task continuation limit reached without completing the remaining work. Review the task list and unblock the next actionable item to resume."

export interface Interface {
  readonly update: (input: {
    readonly sessionID: SessionSchema.ID
    readonly todos: ReadonlyArray<Input>
  }) => Effect.Effect<ReadonlyArray<Info>, Error>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Info>>
  readonly block: (sessionID: SessionSchema.ID, reason: string) => Effect.Effect<ReadonlyArray<Info>, Error>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/v2/SessionTodo") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SessionTodoStore.Service
    const events = yield* EventV2.Service
    const update: Interface["update"] = Effect.fn("SessionTodo.update")(function* (input) {
      const todos = yield* store.update(input)
      yield* events.publish(Event.Updated, { sessionID: input.sessionID, todos })
      return todos
    }, store.withMutation)
    const get = store.get
    const block: Interface["block"] = Effect.fn("SessionTodo.block")(function* (sessionID, reason) {
      const todos = yield* store.block(sessionID, reason)
      yield* events.publish(Event.Updated, { sessionID, todos })
      return todos
    }, store.withMutation)

    return Service.of({ update, get, block })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [EventV2.node, SessionTodoStore.node] })
