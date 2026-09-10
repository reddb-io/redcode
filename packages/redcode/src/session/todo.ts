import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { SessionID } from "./schema"
import { Effect, Layer, Context } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionTodo } from "@reddb-io/redcode-schema/session-todo"
import { SessionTodoStore } from "@reddb-io/redcode-core/session/todo-store"

export const Info = SessionTodo.Info
export type Info = SessionTodo.Info
export const Input = SessionTodo.Input
export type Input = SessionTodo.Input
export const Event = SessionTodo.Event

export interface Interface {
  readonly update: (input: {
    sessionID: SessionID
    todos: ReadonlyArray<Input>
  }) => Effect.Effect<ReadonlyArray<Info>, SessionTodo.Error>
  readonly get: (sessionID: SessionID) => Effect.Effect<Info[]>
  readonly block: (sessionID: SessionID, reason: string) => Effect.Effect<ReadonlyArray<Info>, SessionTodo.Error>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/SessionTodo") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const store = yield* SessionTodoStore.Service
    const update: Interface["update"] = Effect.fn("Todo.update")(function* (input) {
      const todos = yield* store.update(input)
      yield* events.publish(Event.Updated, { sessionID: input.sessionID, todos })
      return todos
    }, store.withMutation)
    const block: Interface["block"] = Effect.fn("Todo.block")(function* (sessionID, reason) {
      const todos = yield* store.block(sessionID, reason)
      yield* events.publish(Event.Updated, { sessionID, todos })
      return todos
    }, store.withMutation)
    return Service.of({ update, get: store.get, block })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [EventV2Bridge.node, SessionTodoStore.node] })

export * as Todo from "./todo"
