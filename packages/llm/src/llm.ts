import { Cause, Effect, Exit, JsonSchema, Schema } from "effect"
import { LLMClient } from "./route/client"
import {
  GenerationOptions,
  HttpOptions,
  InvalidProviderOutputReason,
  LLMError,
  LLMEvent,
  LLMRequest,
  LLMResponse,
  Message,
  type ModelInput as SchemaModelInput,
  SystemPart,
  ToolChoice,
  ToolDefinition,
  type ContentPart,
  ToolResultPart,
} from "./schema"
import { make as makeTool, toDefinitions, type ToolSchema } from "./tool"

export type ModelInput = SchemaModelInput

export type MessageInput = Message.Input

export type ToolChoiceInput = ToolChoice.Input
export type ToolChoiceMode = ToolChoice.Mode

export type ToolResultInput = Parameters<typeof ToolResultPart.make>[0]

/** Input accepted by `LLM.request`, normalized into the canonical `LLMRequest` class. */
export type RequestInput = Omit<
  ConstructorParameters<typeof LLMRequest>[0],
  "system" | "messages" | "tools" | "toolChoice" | "generation" | "http" | "providerOptions"
> & {
  readonly system?: string | SystemPart | ReadonlyArray<SystemPart>
  readonly prompt?: string | ContentPart | ReadonlyArray<ContentPart>
  readonly messages?: ReadonlyArray<Message | MessageInput>
  readonly tools?: ReadonlyArray<ToolDefinition.Input>
  readonly toolChoice?: ToolChoiceInput
  readonly generation?: GenerationOptions.Input
  readonly providerOptions?: ConstructorParameters<typeof LLMRequest>[0]["providerOptions"]
  readonly http?: HttpOptions.Input
}

export const generate = LLMClient.generate

export const stream = LLMClient.stream

export const requestInput = (input: LLMRequest): RequestInput => ({
  ...LLMRequest.input(input),
})

export const request = (input: RequestInput) => {
  const {
    system: requestSystem,
    prompt,
    messages,
    tools,
    toolChoice: requestToolChoice,
    generation: requestGeneration,
    providerOptions: requestProviderOptions,
    http: requestHttp,
    ...rest
  } = input
  return new LLMRequest({
    ...rest,
    system: SystemPart.content(requestSystem),
    messages: [...(messages?.map(Message.make) ?? []), ...(prompt === undefined ? [] : [Message.user(prompt)])],
    tools: tools?.map(ToolDefinition.make) ?? [],
    toolChoice: requestToolChoice ? ToolChoice.make(requestToolChoice) : undefined,
    generation: requestGeneration === undefined ? undefined : GenerationOptions.make(requestGeneration),
    providerOptions: requestProviderOptions,
    http: requestHttp === undefined ? undefined : HttpOptions.make(requestHttp),
  })
}

export const updateRequest = (input: LLMRequest, patch: Partial<RequestInput>) =>
  request({ ...requestInput(input), ...patch })

const GENERATE_OBJECT_TOOL_NAME = "generate_object"

const GENERATE_OBJECT_TOOL_DESCRIPTION = "Return the structured result by calling this tool."

type GenerateObjectBase = Omit<RequestInput, "tools" | "toolChoice" | "responseFormat">

export class GenerateObjectResponse<T> {
  constructor(
    readonly object: T,
    readonly response: LLMResponse,
  ) {}

  get events() {
    return this.response.events
  }

  get usage() {
    return this.response.usage
  }
}

export interface GenerateObjectOptions<S extends ToolSchema<any>> extends GenerateObjectBase {
  readonly schema: S
}

export interface GenerateObjectDynamicOptions extends GenerateObjectBase {
  /** Raw JSON Schema object describing the expected output shape. */
  readonly jsonSchema: JsonSchema.JsonSchema
}

/**
 * Whether a model accepts a forced tool choice (`required` or a named tool). Claude Opus 5.5 and
 * the Fable and Mythos models always think, and the API answers a forced tool choice with a 400 for
 * them. `declared` is what a router says about the model: `false` refuses whatever the id is, so a
 * combo refuses when any member does.
 */
export function supportsForcedToolChoice(modelID: string, declared?: boolean) {
  if (declared === false) return false
  const id = modelID.toLowerCase()
  if (!id.includes("claude-")) return true
  if (/(?:^|[^a-z])(?:fable|mythos)(?:[^a-z]|$)/.test(id)) return false
  const version = /claude-(?:([a-z]+)-)?(\d+)(?:[.-](\d{1,2}))?(?:-([a-z]+))?(?:[.@-]|$)/.exec(id)
  if (!version || (version[1] ?? version[4]) !== "opus") return true
  const major = Number(version[2])
  return major < 5 || (major === 5 && Number(version[3] ?? 0) < 5)
}

const runGenerateObject = Effect.fn("LLM.generateObject")(function* (
  options: GenerateObjectBase,
  tool: ReturnType<typeof makeTool>,
) {
  const baseRequest = request(options)
  if (!supportsForcedToolChoice(baseRequest.model.id, baseRequest.model.compatibility?.forcedToolChoice))
    return yield* generatePromptedObject(baseRequest, tool)
  const generateRequest = LLMRequest.update(baseRequest, {
    tools: toDefinitions({ [GENERATE_OBJECT_TOOL_NAME]: tool }),
    toolChoice: ToolChoice.named(GENERATE_OBJECT_TOOL_NAME),
  })
  const response = yield* LLMClient.generate(generateRequest)
  const call = response.toolCalls.find(
    (event) => LLMEvent.is.toolCall(event) && event.name === GENERATE_OBJECT_TOOL_NAME,
  )
  if (!call || !LLMEvent.is.toolCall(call))
    return yield* new LLMError({
      module: "LLM",
      method: "generateObject",
      reason: new InvalidProviderOutputReason({
        message: `generateObject: model did not call the forced \`${GENERATE_OBJECT_TOOL_NAME}\` tool`,
      }),
    })
  const object = yield* tool._decode(call.input).pipe(
    Effect.mapError(
      (error) =>
        new LLMError({
          module: "LLM",
          method: "generateObject",
          reason: new InvalidProviderOutputReason({
            message: `generateObject: tool input failed schema decode: ${error.message}`,
          }),
        }),
    ),
  )
  return new GenerateObjectResponse(object, response)
})

// Models that refuse a forced tool choice are asked for the bare JSON object instead; the reply is
// validated against the schema and repaired once.
const generatePromptedObject = Effect.fnUntraced(function* (
  baseRequest: LLMRequest,
  tool: ReturnType<typeof makeTool>,
) {
  const instruction = `Respond with ONLY a JSON object that matches this JSON Schema, no other text, do not wrap it in backticks:\n${JSON.stringify(tool._definition.inputSchema)}`
  const promptedRequest = LLMRequest.update(baseRequest, {
    system: [...baseRequest.system, SystemPart.make(instruction)],
  })
  const first = yield* LLMClient.generate(promptedRequest)
  const parsed = yield* Effect.exit(decodePrompted(tool, first.text))
  if (Exit.isSuccess(parsed)) return new GenerateObjectResponse(parsed.value, first)
  const repair = yield* LLMClient.generate(
    LLMRequest.update(promptedRequest, {
      messages: [
        ...promptedRequest.messages,
        Message.assistant(first.text),
        Message.user(
          `That reply was not a valid JSON object for the schema: ${Cause.pretty(parsed.cause)}\n\nReturn ONLY the JSON object, no other text, do not wrap it in backticks.`,
        ),
      ],
    }),
  )
  const object = yield* decodePrompted(tool, repair.text).pipe(
    Effect.mapError(
      (error) =>
        new LLMError({
          module: "LLM",
          method: "generateObject",
          reason: new InvalidProviderOutputReason({
            message: `generateObject: reply failed schema decode after one repair: ${error.message}`,
          }),
        }),
    ),
  )
  return new GenerateObjectResponse(object, repair)
})

// Models asked for bare JSON still wrap it in a fenced block now and then.
const decodePrompted = (tool: ReturnType<typeof makeTool>, text: string) =>
  decodeJson(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text)?.[1] ?? text.trim()).pipe(
    Effect.flatMap(tool._decode),
  )

const decodeJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)

/**
 * Run a model and decode its output against `schema`. Works on every protocol
 * because it forces a synthetic tool call internally — provider-native JSON
 * modes are intentionally avoided so behaviour is uniform. Models that refuse a
 * forced tool choice (see `supportsForcedToolChoice`) are prompted for the bare
 * JSON object instead, validated against the same schema and repaired once.
 *
 * Two input modes:
 *
 * 1. `schema: EffectSchema<T>` — `.object` is decoded and typed as `T`.
 *    Decode failures surface as `LLMError`.
 * 2. `jsonSchema: JsonSchema.JsonSchema` — `.object` is `unknown`. Use when
 *    the schema is only available at runtime (MCP, plugin manifests). Caller validates.
 */
export function generateObject<S extends ToolSchema<any>>(
  options: GenerateObjectOptions<S>,
): Effect.Effect<GenerateObjectResponse<Schema.Schema.Type<S>>, LLMError>
export function generateObject(
  options: GenerateObjectDynamicOptions,
): Effect.Effect<GenerateObjectResponse<unknown>, LLMError>
export function generateObject(options: GenerateObjectOptions<ToolSchema<any>> | GenerateObjectDynamicOptions) {
  if ("schema" in options) {
    const { schema, ...rest } = options
    return runGenerateObject(
      rest,
      makeTool({
        description: GENERATE_OBJECT_TOOL_DESCRIPTION,
        parameters: schema,
        success: Schema.Unknown as ToolSchema<unknown>,
        execute: () => Effect.void,
      }),
    )
  }
  const { jsonSchema, ...rest } = options
  return runGenerateObject(
    rest,
    makeTool({
      description: GENERATE_OBJECT_TOOL_DESCRIPTION,
      jsonSchema,
      execute: () => Effect.void,
    }),
  )
}
