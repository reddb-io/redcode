import { Semantic } from "../semantic"
import { Intelligence } from "../intelligence"
export * as TodoWriteTool from "./todowrite"

import { ToolFailure } from "@reddb-io/redcode-llm"
import { Effect, JsonSchema, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { SessionTaskFacts } from "../session/task-facts"
import { SessionTodo } from "../session/todo"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "todowrite"

export const Input = Schema.Struct({
  sourceMessageID: Schema.String.pipe(Schema.optional),
  todos: Schema.Array(SessionTodo.Input).annotate({
    description: "Tasks to create or update; omitted tasks are preserved. Empty array reads the current list.",
  }),
})
// Decoded from the model's spelling (text, title or task fold into content) while the advertised
// JSON schema stays the canonical Input.
const ModelInput = Schema.Struct({
  sourceMessageID: Schema.String.pipe(Schema.optional),
  todos: Schema.Array(SessionTodo.ModelInput),
})

export const Output = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info),
  notes: Schema.optional(Schema.Array(Schema.String)),
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
  [
    ...(output.notes ?? []),
    JSON.stringify(
      output.availableEvidence ? { todos: output.todos, availableEvidence: output.availableEvidence } : output.todos,
      null,
      2,
    ),
  ].join("\n")

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const todos = yield* SessionTodo.Service
    const facts = yield* SessionTaskFacts.Service
    const permission = yield* PermissionV2.Service
    const semantic = yield* Semantic.Service
    const intelligence = yield* Intelligence.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            SessionTodo.guidance +
            " sourceMessageID with todos: [] delegates decomposition of that user request to the configured transformation model. " +
            " Supply the id when updating; revision is optional and checked when supplied. Blocked and cancelled tasks require reason. The next pending task becomes active automatically. Send todos: [] to read the current list.",
          input: ModelInput,
          inputSchema: inputSchema(),
          formatInputError: SessionTodo.validationHint,
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
              const observed = input.sourceMessageID ? yield* facts.load(context.sessionID) : undefined
              const source = observed?.requests.find(
                (request) => request.id === input.sourceMessageID && !request.pending,
              )
              if (input.sourceMessageID && (!source || input.todos.length))
                return yield* new ToolFailure({
                  message: "Use sourceMessageID with todos: [] and an existing promoted request",
                })
              const generated = source
                ? yield* semantic
                    .transform<ReadonlyArray<SessionTodo.Input>>({
                      sessionID: context.sessionID,
                      operation: "todos",
                      sources: source,
                      prompt: `Decompose this user request into tasks covering every requested deliverable and verification. Return only a JSON array with content, priority (high/medium/low), requirement (exact source quote), criterion (observable acceptance condition). Source: ${JSON.stringify(source)}`,
                      decode: Semantic.json(Schema.Array(SessionTodo.Input).check(Schema.isMinLength(1))),
                      checks: (candidate) =>
                        Intelligence.questions(
                          Object.fromEntries(
                            candidate
                              .map((_, index) => [
                                `task_${index}`,
                                `Does candidate[${index}] misrepresent sources.text or lack a verifiable acceptance criterion?`,
                              ])
                              .concat([
                                [
                                  "coverage",
                                  "Does candidate omit a requested deliverable or verification from sources.text?",
                                ],
                              ]),
                          ),
                        ),
                    })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
                : undefined
              if (source && !generated)
                return yield* new ToolFailure({
                  message: "Tasks could not be extracted from the request; retry or supply todos directly",
                })
              const written = yield* todos.write({
                sessionID: context.sessionID,
                todos: generated ?? input.todos,
                messageID: context.assistantMessageID,
              })
              const updated = written.todos
              const completed = input.todos.some((todo) => todo.status === "completed")
              const unverified =
                completed && Intelligence.mode(yield* intelligence.read().pipe(Effect.orDie)) === "single"
              const notes = [
                ...SessionTodo.notes(
                  input.todos,
                  updated,
                  SessionTodo.quotesCommand(input.todos, updated) ? (yield* facts.load(context.sessionID)).results : [],
                ),
                ...(unverified
                  ? [`Completion passed the structural evidence checks; S1 review ${Intelligence.UNVERIFIED}.`]
                  : []),
                ...written.notes,
              ]
              return {
                todos: updated,
                ...(notes.length ? { notes } : {}),
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

function inputSchema(): JsonSchema.JsonSchema {
  const document = Schema.toJsonSchemaDocument(Input)
  if (Object.keys(document.definitions).length === 0) return document.schema
  return { ...document.schema, $defs: document.definitions }
}

export const node = makeLocationNode({
  name: "tool/todowrite",
  layer,
  deps: [
    ToolRegistry.node,
    PermissionV2.node,
    SessionTodo.node,
    SessionTaskFacts.node,
    Semantic.node,
    Intelligence.node,
  ],
})
