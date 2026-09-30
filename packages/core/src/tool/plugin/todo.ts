export * as TodoTool from "./todo.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Permission } from "../../permission.js"
import { SessionTaskFacts } from "../../session/task-facts.js"
import { SessionTodo } from "../../session/todo.js"
import { SessionTodoStore } from "../../session/todo-store.js"

export const name = "todowrite"

export const Plugin = {
  id: "opencode.tool.todo",
  effect: Effect.fn("TodoTool.Plugin")(function* (ctx: Context) {
    const todos = yield* SessionTodoStore.Service
    const facts = yield* SessionTaskFacts.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: `${SessionTodo.guidance} Send todos: [] to inspect current tasks and available evidence.`,
          input: Schema.Struct({
            todos: Schema.Array(SessionTodo.ModelInput).annotate({
              description:
                "Tasks to create or update; omitted tasks are preserved. Empty array reads the current list.",
            }),
          }),
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              yield* todos.review(context.sessionID)
              const written = yield* todos.write({
                sessionID: context.sessionID,
                todos: input.todos,
                messageID: context.messageID,
                phase: SessionTodo.phase(context.agent),
              })
              const notes = [
                ...SessionTodo.notes(
                  input.todos,
                  SessionTodo.forAgent(written.todos, context.agent),
                  SessionTodo.quotesCommand(input.todos, written.todos)
                    ? (yield* facts.load(context.sessionID)).results
                    : [],
                ),
                ...written.notes,
              ]
              const output = JSON.stringify({
                todos: SessionTodo.forAgent(written.todos, context.agent),
                ...(notes.length ? { notes } : {}),
                ...(input.todos.length ? {} : { availableEvidence: yield* facts.available(context.sessionID) }),
              })
              return { output, content: output, metadata: { count: written.todos.length } }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
