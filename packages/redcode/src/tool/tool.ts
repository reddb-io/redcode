import { PermissionV1 } from "@reddb-io/redcode-core/v1/permission"
import { Effect, Schema } from "effect"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { MessageV2 } from "../session/message-v2"
import type { Permission } from "../permission"
import type { SessionID, MessageID } from "../session/schema"
import { ToolOutputBridge } from "./output-bridge"
import { SessionTodo } from "@reddb-io/redcode-core/session/todo"
import type { Agent } from "@/agent/agent"

/** The task ids a todowrite call names, read from arguments that may have any shape. */
function namedTasks(args: unknown) {
  const todos = typeof args === "object" && args !== null ? (args as { todos?: unknown }).todos : undefined
  if (!Array.isArray(todos)) return []
  return todos.flatMap((item) =>
    typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string"
      ? [(item as { id: string }).id]
      : [],
  )
}

interface Metadata {
  [key: string]: any
}

// TODO: remove this hack
export type DynamicDescription = (agent: Agent.Info) => Effect.Effect<string>

/**
 * Raised when the LLM calls a tool with arguments that fail the parameter
 * schema. This is the canonical "rewrite the input" tool error: the typed
 * error class makes it matchable upstream, and its `message` getter produces
 * the model-facing prose that the AI SDK feeds back as the tool result.
 */
export class InvalidArgumentsError extends Schema.TaggedErrorClass<InvalidArgumentsError>()(
  "ToolInvalidArgumentsError",
  {
    tool: Schema.String,
    detail: Schema.String,
  },
) {
  override get message() {
    return `The ${this.tool} tool was called with invalid arguments: ${this.detail}.\nPlease rewrite the input so it satisfies the expected schema.`
  }
}

export type Context<M extends Metadata = Metadata> = {
  sessionID: SessionID
  messageID: MessageID
  agent: string
  abort: AbortSignal
  callID?: string
  extra?: { [key: string]: unknown }
  messages: SessionV1.WithParts[]
  metadata(input: { title?: string; metadata?: M }): Effect.Effect<void>
  ask(input: Omit<PermissionV1.Request, "id" | "sessionID" | "tool"> & { force?: boolean }): Effect.Effect<void>
  /** What the permission rules say about a request, without asking anyone; absent where the rules are not known. */
  evaluate?(permission: string, pattern: string): "allow" | "ask" | "deny"
  /** Present when the runtime lets this tool make tool calls of its own (code mode's `execute`). */
  nested?: Nested
}

/** A tool call made from inside another tool, such as a code mode script. */
export type NestedCall<A> = {
  /** The tool ID hooks, the loop guard and the deadline see, e.g. `github_issue_read` or `read`. */
  readonly tool: string
  readonly args: Record<string, unknown>
  /**
   * Makes the call with the arguments PreExecute hooks decided, under a context of its own: a
   * `parent/N` call ID, an abort signal the call's deadline controls, and a `metadata` that never
   * rewrites the parent's part.
   */
  readonly run: (input: { readonly args: Record<string, unknown>; readonly ctx: Context }) => Effect.Effect<A, unknown>
}

export type NativeTool = Pick<Def, "id" | "description" | "parameters" | "jsonSchema" | "execute">

export interface Nested {
  /**
   * Runs one call through the same per-call policy as a direct call: `tool.execute.before`,
   * PreExecute hooks (which may rewrite or refuse the arguments), the loop guard, and the tool
   * deadline with permission waits deducted. PostExecute hooks see its outcome.
   */
  readonly call: <A>(input: NestedCall<A>) => Effect.Effect<A, unknown>
  /** The read-only native tools a script may call this step, already filtered by permission rules. */
  readonly natives: ReadonlyArray<NativeTool>
  /** The prompt's per-tool switches (`user.tools`); a tool switched off must not be callable from a script. */
  readonly userTools?: Readonly<Record<string, boolean>>
}

export interface ExecuteResult<M extends Metadata = Metadata> {
  title: string
  metadata: M
  output: string
  attachments?: Omit<SessionV1.FilePart, "id" | "sessionID" | "messageID">[]
}

export interface Def<
  Parameters extends Schema.Decoder<unknown> = Schema.Decoder<unknown>,
  M extends Metadata = Metadata,
> {
  id: string
  description: string
  parameters: Parameters
  jsonSchema?: JSONSchema7
  execute(args: Schema.Schema.Type<Parameters>, ctx: Context): Effect.Effect<ExecuteResult<M>>
  formatValidationError?(error: unknown): string
}
export type DefWithoutID<
  Parameters extends Schema.Decoder<unknown> = Schema.Decoder<unknown>,
  M extends Metadata = Metadata,
> = Omit<Def<Parameters, M>, "id">

export interface Info<
  Parameters extends Schema.Decoder<unknown> = Schema.Decoder<unknown>,
  M extends Metadata = Metadata,
> {
  id: string
  init: () => Effect.Effect<DefWithoutID<Parameters, M>>
}

type Init<Parameters extends Schema.Decoder<unknown>, M extends Metadata> =
  | DefWithoutID<Parameters, M>
  | (() => Effect.Effect<DefWithoutID<Parameters, M>>)

export type InferParameters<T> =
  T extends Info<infer P, any>
    ? Schema.Schema.Type<P>
    : T extends Effect.Effect<Info<infer P, any>, any, any>
      ? Schema.Schema.Type<P>
      : never
export type InferMetadata<T> =
  T extends Info<any, infer M> ? M : T extends Effect.Effect<Info<any, infer M>, any, any> ? M : never

export type InferDef<T> =
  T extends Info<infer P, infer M>
    ? Def<P, M>
    : T extends Effect.Effect<Info<infer P, infer M>, any, any>
      ? Def<P, M>
      : never

function wrap<Parameters extends Schema.Decoder<unknown>, Result extends Metadata>(
  id: string,
  init: Init<Parameters, Result>,
  outputs: ToolOutputBridge.Interface,
) {
  return () =>
    Effect.gen(function* () {
      const toolInfo = typeof init === "function" ? { ...(yield* init()) } : { ...init }
      // Compile the parser closure once per tool init; `decodeUnknownEffect`
      // allocates a new closure per call, so hoisting avoids re-closing it for
      // every LLM tool invocation.
      // Every problem at once, so a model fixing its arguments needs one retry, not one per key.
      const decode = Schema.decodeUnknownEffect(toolInfo.parameters, { errors: "all" })
      const execute = toolInfo.execute
      toolInfo.execute = (args, ctx) => {
        const attrs = {
          "tool.name": id,
          "session.id": ctx.sessionID,
          "message.id": ctx.messageID,
          ...(ctx.callID ? { "tool.call_id": ctx.callID } : {}),
        }
        return Effect.gen(function* () {
          const decoded = yield* decode(args).pipe(
            // Task updates fail silently in a folded TUI row; the log is where the reason survives. It
            // records which keys were wrong and which tasks were named, never the content.
            Effect.tapError((error) =>
              id === "todowrite"
                ? Effect.logWarning("todowrite refused", {
                    ...attrs,
                    kind: "schema",
                    keys: SessionTodo.schemaProblems(error.message)
                      .map((problem) => problem.path || "<root>")
                      .join(","),
                    tasks: namedTasks(args).join(","),
                    error: (error.message.split("\n")[0] ?? "").slice(0, 80),
                  })
                : Effect.void,
            ),
            Effect.mapError(
              (error) =>
                new InvalidArgumentsError({
                  tool: id,
                  detail: toolInfo.formatValidationError ? toolInfo.formatValidationError(error) : String(error),
                }),
            ),
          )
          const result = yield* execute(decoded as Schema.Schema.Type<Parameters>, ctx)
          if (result.metadata.truncated !== undefined) {
            return result
          }
          const truncated = yield* outputs.bound(result.output, ctx)
          return {
            ...result,
            output: truncated.content,
            metadata: {
              ...result.metadata,
              truncated: truncated.truncated,
              ...(truncated.truncated && truncated.outputPath ? { outputPath: truncated.outputPath } : {}),
            },
          }
        }).pipe(Effect.orDie, Effect.withSpan("Tool.execute", { attributes: attrs }))
      }
      return toolInfo
    })
}

export function define<
  Parameters extends Schema.Decoder<unknown>,
  Result extends Metadata,
  R,
  ID extends string = string,
>(
  id: ID,
  init: Effect.Effect<Init<Parameters, Result>, never, R>,
): Effect.Effect<Info<Parameters, Result>, never, R | ToolOutputBridge.Service> & { id: ID } {
  return Object.assign(
    Effect.gen(function* () {
      const resolved = yield* init
      const outputs = yield* ToolOutputBridge.Service
      return { id, init: wrap(id, resolved, outputs) }
    }),
    { id },
  )
}

export function init<P extends Schema.Decoder<unknown>, M extends Metadata>(
  info: Info<P, M>,
): Effect.Effect<Def<P, M>> {
  return Effect.gen(function* () {
    const init = yield* info.init()
    return {
      ...init,
      id: info.id,
    }
  })
}

export * as Tool from "./tool"
