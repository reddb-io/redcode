import { SessionTaskFacts } from "@reddb-io/redcode-core/session/task-facts"
import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"

export const Parameters = Schema.Struct({
  todos: Schema.mutable(Schema.Array(Todo.Input)).annotate({ description: "The updated todo list" }),
})

type Metadata = {
  todos: ReadonlyArray<Todo.Info>
}

export const TodoWriteTool = Tool.define<typeof Parameters, Metadata, Todo.Service | SessionTaskFacts.Service>(
  "todowrite",
  Effect.gen(function* () {
    const todo = yield* Todo.Service
    const facts = yield* SessionTaskFacts.Service

    return {
      description: DESCRIPTION_WRITE,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "todowrite",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const todos = yield* todo
            .update({
              sessionID: ctx.sessionID,
              todos: params.todos,
            })
            .pipe(Effect.orDie)

          return {
            title: `${todos.filter((x) => x.status !== "completed" && x.status !== "cancelled").length} todos`,
            output: JSON.stringify(
              params.todos.length ? todos : { todos, availableEvidence: yield* facts.available(ctx.sessionID) },
              null,
              2,
            ),
            metadata: {
              todos,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
