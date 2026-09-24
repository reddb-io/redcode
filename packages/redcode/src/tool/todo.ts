import { SessionTaskFacts } from "@reddb-io/redcode-core/session/task-facts"
import { SessionTodo } from "@reddb-io/redcode-core/session/todo"
import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import { ToolJsonSchema } from "./json-schema"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"

export const Parameters = Schema.Struct({
  todos: Schema.mutable(Schema.Array(Todo.Input)).annotate({ description: "The updated todo list" }),
})
// Decoded from the model's spelling (text, title or task fold into content) while the advertised
// JSON schema stays the canonical Parameters.
export const ModelParameters = Schema.Struct({
  todos: Schema.mutable(Schema.Array(Todo.ModelInput)).annotate({ description: "The updated todo list" }),
})

type Metadata = {
  todos: ReadonlyArray<Todo.Info>
  /** Set when S1 could not verify the update: it applied, and the TUI labels it unverified. */
  unverified?: boolean
}

export const TodoWriteTool = Tool.define<typeof ModelParameters, Metadata, Todo.Service | SessionTaskFacts.Service>(
  "todowrite",
  Effect.gen(function* () {
    const todo = yield* Todo.Service
    const facts = yield* SessionTaskFacts.Service

    return {
      description: DESCRIPTION_WRITE,
      parameters: ModelParameters,
      jsonSchema: ToolJsonSchema.fromSchema(Parameters),
      // Effect's SchemaError is not an `instanceof Error` here; its `message` getter is what carries
      // each problem with its path, while `String(error)` wraps them in `SchemaError(…)`.
      formatValidationError: (error) =>
        SessionTodo.validationHint(
          typeof (error as { message?: unknown } | null)?.message === "string"
            ? (error as { message: string }).message
            : String(error),
        ),
      execute: (params: Schema.Schema.Type<typeof ModelParameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "todowrite",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const written = yield* todo
            .write({
              sessionID: ctx.sessionID,
              todos: params.todos,
              messageID: ctx.messageID,
            })
            .pipe(Effect.orDie)
          const todos = written.todos
          const notes = [
            ...SessionTodo.notes(
              params.todos,
              todos,
              SessionTodo.quotesCommand(params.todos, todos) ? (yield* facts.load(ctx.sessionID)).results : [],
            ),
            ...written.notes,
          ]

          return {
            title: `${todos.filter((x) => x.status !== "completed" && x.status !== "cancelled").length} todos`,
            output: [
              ...notes,
              JSON.stringify(
                params.todos.length ? todos : { todos, availableEvidence: yield* facts.available(ctx.sessionID) },
                null,
                2,
              ),
            ].join("\n"),
            metadata: {
              todos,
              ...(written.notes.length ? { unverified: true } : {}),
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof ModelParameters, Metadata>
  }),
)
