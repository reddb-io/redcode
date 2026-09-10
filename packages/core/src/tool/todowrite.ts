export * as TodoWriteTool from "./todowrite"

import { ToolFailure } from "@reddb-io/redcode-llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { SessionTaskFacts } from "../session/task-facts"
import { SessionTodo } from "../session/todo"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "todowrite"

export const Input = Schema.Struct({
  todos: Schema.Array(SessionTodo.Input).annotate({
    description: "Tasks to create or update; omitted tasks are preserved. Empty array reads the current list.",
  }),
})

export const Output = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info),
  availableEvidence: Schema.optional(
    Schema.Struct({
      requests: Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String, created: Schema.Number })),
      results: Schema.Array(
        Schema.Struct({
          callID: Schema.String,
          messageID: Schema.String,
          tool: Schema.String,
          successful: Schema.Boolean,
          summary: Schema.String,
        }),
      ),
    }),
  ),
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) =>
  JSON.stringify(output.availableEvidence ? output : output.todos, null, 2)

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const todos = yield* SessionTodo.Service
    const facts = yield* SessionTaskFacts.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            SessionTodo.guidance +
            " Supply id and revision from the last result when updating. Blocked and cancelled tasks require reason. The next pending task becomes active automatically. Send todos: [] to read the current list.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              return {
                todos: yield* todos.update({ sessionID: context.sessionID, todos: input.todos }),
                ...(input.todos.length ? {} : { availableEvidence: yield* facts.available(context.sessionID) }),
              }
            }).pipe(
              Effect.mapError(
                (error) =>
                  new ToolFailure({
                    message: error instanceof SessionTodo.Error ? error.message : "Unable to update todos",
                  }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/todowrite",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, SessionTodo.node, SessionTaskFacts.node],
})
