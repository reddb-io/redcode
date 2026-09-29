import { Cause, Effect, Exit, JsonSchema, Schema, Stream } from "effect"
import { supportsForcedToolChoice } from "./forced-tool-choice.js"
import { tryRequest } from "./media-model.js"
import { LLMClient, Service, type StreamOptions } from "./route/client.js"
import {
  GenerationOptions,
  HttpOptions,
  InvalidProviderOutputError,
  AIError,
  LLMEvent,
  LLMRequest,
  LLMResponse,
  Message,
  LanguageModel,
  SystemPart,
  ToolChoice,
  ToolEntry,
  type ContentPart,
  type LanguageModelProviderOptions,
  type ToolEntryInput,
} from "./schema/index.js"
import { make as makeTool, toDefinitions, type ToolSchema } from "./tool.js"
import { Json, encodeJson } from "./utils/json.js"

/** Input accepted by `LLM.request`, normalized into the canonical `LLMRequest` class. */
export type RequestInput<SelectedLanguageModel extends LanguageModel = LanguageModel> = Omit<
  ConstructorParameters<typeof LLMRequest>[0],
  "model" | "system" | "messages" | "tools" | "toolChoice" | "generation" | "http" | "providerOptions"
> & {
  readonly model: SelectedLanguageModel
  readonly system?: string | SystemPart | ReadonlyArray<SystemPart>
  readonly prompt?: string | ContentPart | ReadonlyArray<ContentPart>
  readonly messages?: ReadonlyArray<Message | Message.Input>
  readonly tools?: ReadonlyArray<ToolEntryInput>
  readonly toolChoice?: ToolChoice.Input
  readonly generation?: GenerationOptions.Input
  readonly providerOptions?: NoInfer<LanguageModelProviderOptions<SelectedLanguageModel>>
  readonly http?: HttpOptions.Input
}

export function generate<const Model extends LanguageModel>(
  input: RequestInput<Model>,
  options?: StreamOptions,
): Effect.Effect<LLMResponse, AIError, Service>
export function generate(input: LLMRequest, options?: StreamOptions): Effect.Effect<LLMResponse, AIError, Service>
export function generate(input: RequestInput | LLMRequest, options?: StreamOptions) {
  return requestEffect(input).pipe(Effect.flatMap((request) => LLMClient.generate(request, options)))
}

export function stream<const Model extends LanguageModel>(
  input: RequestInput<Model>,
  options?: StreamOptions,
): Stream.Stream<LLMEvent, AIError, Service>
export function stream(input: LLMRequest, options?: StreamOptions): Stream.Stream<LLMEvent, AIError, Service>
export function stream(input: RequestInput | LLMRequest, options?: StreamOptions) {
  return Stream.unwrap(requestEffect(input).pipe(Effect.map((request) => LLMClient.stream(request, options))))
}

const requestEffect = (input: RequestInput | LLMRequest) =>
  input instanceof LLMRequest ? Effect.succeed(input) : tryRequest(() => request(input))

export const request = <const SelectedLanguageModel extends LanguageModel>(
  input: RequestInput<SelectedLanguageModel>,
) => {
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
    tools: tools?.map(ToolEntry.make) ?? [],
    toolChoice: requestToolChoice ? ToolChoice.make(requestToolChoice) : undefined,
    generation: requestGeneration === undefined ? undefined : GenerationOptions.make(requestGeneration),
    providerOptions: requestProviderOptions,
    http: HttpOptions.make(requestHttp),
  })
}

const GENERATE_OBJECT_TOOL_NAME = "generate_object"

const GENERATE_OBJECT_TOOL_DESCRIPTION = "Return the structured result by calling this tool."

type GenerateObjectBase<SelectedLanguageModel extends LanguageModel = LanguageModel> = Omit<
  RequestInput<SelectedLanguageModel>,
  "tools" | "toolChoice"
>

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

export interface GenerateObjectOptions<
  S extends ToolSchema<any>,
  SelectedLanguageModel extends LanguageModel = LanguageModel,
> extends GenerateObjectBase<SelectedLanguageModel> {
  readonly schema: S
}

export interface GenerateObjectDynamicOptions<SelectedLanguageModel extends LanguageModel = LanguageModel>
  extends GenerateObjectBase<SelectedLanguageModel> {
  /** Raw JSON Schema object describing the expected output shape. */
  readonly jsonSchema: JsonSchema.JsonSchema
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
    return yield* new AIError({
      reason: new InvalidProviderOutputError({
        message: `generateObject: model did not call the forced \`${GENERATE_OBJECT_TOOL_NAME}\` tool`,
      }),
    })
  const object = yield* tool._decode(call.input).pipe(
    Effect.mapError(
      (error) =>
        new AIError({
          reason: new InvalidProviderOutputError({
            message: `generateObject: tool input failed schema decode: ${error.message}`,
            cause: error,
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
  const promptedRequest = LLMRequest.update(baseRequest, {
    system: [
      ...baseRequest.system,
      SystemPart.make(
        `Respond with ONLY a JSON object that matches this JSON Schema, no other text, do not wrap it in backticks:\n${encodeJson(tool._definition.inputSchema)}`,
      ),
    ],
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
        new AIError({
          reason: new InvalidProviderOutputError({
            message: `generateObject: reply failed schema decode after one repair: ${error.message}`,
            cause: error,
          }),
        }),
    ),
  )
  return new GenerateObjectResponse(object, repair)
})

// Models asked for bare JSON still wrap it in a fenced block now and then.
const decodePrompted = (tool: ReturnType<typeof makeTool>, text: string) =>
  Schema.decodeUnknownEffect(Json)(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text)?.[1] ?? text.trim()).pipe(
    Effect.flatMap(tool._decode),
  )

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
 *    Decode failures surface as `AIError`.
 * 2. `jsonSchema: JsonSchema.JsonSchema` — `.object` is `unknown`. Use when
 *    the schema is only available at runtime (MCP, plugin manifests). Caller validates.
 */
export function generateObject<const SelectedLanguageModel extends LanguageModel, S extends ToolSchema<any>>(
  options: GenerateObjectOptions<S, SelectedLanguageModel>,
): Effect.Effect<GenerateObjectResponse<Schema.Schema.Type<S>>, AIError, Service>
export function generateObject<const SelectedLanguageModel extends LanguageModel>(
  options: GenerateObjectDynamicOptions<SelectedLanguageModel>,
): Effect.Effect<GenerateObjectResponse<unknown>, AIError, Service>
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
