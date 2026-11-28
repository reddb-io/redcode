import type { ToolDefinition } from "@opencode/ai"
import { Tool } from "@opencode/schema/tool"
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec"
import { Effect, JsonSchema, Result, Schema, SchemaIssue, SchemaRepresentation } from "effect"
import { $ZodType, toJSONSchema } from "zod/v4/core"

const formatEffectIssues = SchemaIssue.makeFormatterStandardSchemaV1()

// Codecs for raw JSON Schema inputs are built once per immutable schema object. Effect Cache retains the lookup
// fiber, including the caller stack and Location-scoped services captured by it, after the entry is evicted.
const jsonSchemas = new WeakMap<object, Schema.Codec<unknown> | undefined>()

export const codecFor = (schema: JsonSchema.JsonSchema) => {
  if (jsonSchemas.has(schema)) return jsonSchemas.get(schema)
  const codec = Result.try(() => jsonSchema(schema)).pipe(Result.getOrUndefined)
  jsonSchemas.set(schema, codec)
  return codec
}

export const definition = (tool: Tool.Info<any, any>): ToolDefinition => ({
  type: "tool",
  name: effectiveName(tool),
  description: tool.description,
  inputSchema: inputJsonSchema(tool.input),
  ...(tool.output === undefined ? {} : { outputSchema: outputJsonSchema(tool.output) }),
})

export const execute = (tool: Tool.Info<any, any>, input: unknown, context: Tool.Context) =>
  Effect.gen(function* () {
    const decoded = yield* decodeInput(tool, input)
    // Tool implementations declare `Tool.Error` but plugins can fail with anything at
    // runtime. A foreign typed failure would slip past every `catchTag("Tool.Error")`
    // downstream and leave its call permanently unsettled, so the declared contract is
    // enforced here at the untrusted boundary. Declines tunnel through as defects and
    // interrupts are not errors; neither is touched.
    const result = yield* tool.execute(decoded, context).pipe(
      Effect.mapError((error: unknown) =>
        error instanceof Tool.Error
          ? error
          : new Tool.Error({
              message: error instanceof globalThis.Error ? error.message : String(error),
            }),
      ),
    )
    if (tool.output === undefined) {
      if ("output" in result) return yield* Effect.die("Tool result declared output without an output schema")
      return {
        output: undefined,
        content: normalizeContent(result.content),
        ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
      }
    }
    if (!("output" in result)) return yield* new Tool.Error({ message: "Tool did not return its declared output" })
    const output = yield* encodeOutput(tool.output, result.output)
    return {
      output,
      content: normalizeContent(result.content, output),
      ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
    }
  })

const decodeInput = (tool: Tool.Info<any, any>, value: unknown) =>
  Effect.gen(function* () {
    const result = yield* validateInput(tool.input, value)
    if (result.issues)
      return yield* new Tool.Error({ message: formatInputIssues(effectiveName(tool), result.issues, value) })
    return result.value
  })

const validateInput = (
  schema: Tool.ValueSchema<any>,
  value: unknown,
): Effect.Effect<StandardSchemaV1.Result<unknown>> => {
  if (isStandardSchema(schema))
    return Effect.gen(function* () {
      if (isStandardJSONSchema(schema)) {
        const json = standardJsonSchema(schema, "input")
        const codec = hasClosedObject(json) ? codecFor(json) : undefined
        if (codec) {
          const structural = yield* Schema.decodeUnknownEffect(codec)(value, {
            errors: "all",
            onExcessProperty: "error",
          }).pipe(
            Effect.match({
              onFailure: (error) => formatEffectIssues(error.issue),
              onSuccess: () => undefined,
            }),
          )
          if (structural) return structural
        }
      }
      return yield* validateStandard(schema, value)
    })
  return Effect.gen(function* () {
    const codec = Schema.isSchema(schema) ? schema : codecFor(schema)
    if (codec === undefined) return { value }
    return yield* Schema.decodeUnknownEffect(codec)(value, { errors: "all", onExcessProperty: "error" }).pipe(
      Effect.match({
        onFailure: (error) => formatEffectIssues(error.issue),
        onSuccess: (value) => ({ value }),
      }),
    )
  })
}

const hasClosedObject = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasClosedObject)
  if (!isRecord(value)) return false
  return value.additionalProperties === false || Object.values(value).some(hasClosedObject)
}

const formatInputIssues = (tool: string, issues: ReadonlyArray<StandardSchemaV1.Issue>, value: unknown) => {
  const details = issues.slice(0, 5).map((issue) => {
    const path =
      issue.path?.reduce<string>((path, segment) => {
        const key = typeof segment === "object" ? segment.key : segment
        if (typeof key === "number") return `${path}[${key}]`
        return path === "" ? String(key) : `${path}.${String(key)}`
      }, "") || "root"
    return `- ${path}: ${issue.message}`
  })
  if (issues.length > 5) details.push(`- ...and ${issues.length - 5} more ${issues.length === 6 ? "issue" : "issues"}`)
  return `Invalid arguments for tool "${tool}":\n${details.join("\n")}\n\nArguments provided:\n${JSON.stringify(value, null, 2)}\n\nUpdate the arguments and call the tool again.`
}

const jsonSchema = (schema: JsonSchema.JsonSchema) => {
  const draft =
    (typeof schema.$schema === "string" && schema.$schema.includes("draft-07")) || "definitions" in schema
      ? JsonSchema.fromSchemaDraft07(schema)
      : JsonSchema.fromSchemaDraft2020_12(schema)
  return Schema.make<Schema.Codec<unknown>>(SchemaRepresentation.fromJsonSchemaDocument(draft).ast)
}

const encodeOutput = (schema: Tool.ValueSchema<any>, value: unknown) => {
  if (Schema.isSchema(schema))
    return Schema.encodeEffect(schema)(value).pipe(
      Effect.mapError(
        (error) =>
          new Tool.Error({ message: `Tool returned an invalid value for its output schema: ${error.message}` }),
      ),
    )
  if (isStandardSchema(schema))
    return validateStandard(schema, value).pipe(
      Effect.flatMap((result) =>
        result.issues
          ? new Tool.Error({
              message: `Tool returned an invalid value for its output schema: ${result.issues.map((issue) => issue.message).join(", ")}`,
            })
          : Effect.succeed(result.value),
      ),
    )
  return Schema.decodeUnknownEffect(Schema.Json)(value).pipe(
    Effect.mapError(
      (error) => new Tool.Error({ message: `Tool returned a non-JSON value for its output schema: ${error.message}` }),
    ),
  )
}

const isStandardSchema = (schema: Tool.ValueSchema<any>): schema is StandardSchemaV1<any, any> =>
  typeof schema === "object" && schema !== null && "~standard" in schema

const isStandardJSONSchema = (
  schema: StandardSchemaV1<any, any>,
): schema is StandardSchemaV1<any, any> & StandardJSONSchemaV1<any, any> => "jsonSchema" in schema["~standard"]

const validateStandard = (
  schema: StandardSchemaV1<any, any>,
  value: unknown,
): Effect.Effect<StandardSchemaV1.Result<unknown>> =>
  Effect.gen(function* () {
    const result = yield* Effect.try({ try: () => schema["~standard"].validate(value), catch: (error) => error })
    return result instanceof Promise ? yield* Effect.tryPromise({ try: () => result, catch: (error) => error }) : result
  }).pipe(
    Effect.match({
      onFailure: (error) => ({ issues: [{ message: error instanceof Error ? error.message : String(error) }] }),
      onSuccess: (result) => result,
    }),
  )

const inputJsonSchema = (schema: Tool.ValueSchema<any>): JsonSchema.JsonSchema => {
  if (schema === undefined || schema === null) return {}
  if (isStandardSchema(schema)) return standardJsonSchema(schema, "input")
  return Schema.isSchema(schema) ? toJsonSchema(schema, true) : schema
}

const outputJsonSchema = (schema: Tool.ValueSchema<any>): JsonSchema.JsonSchema => {
  if (isStandardSchema(schema)) return standardJsonSchema(schema, "output")
  return Schema.isSchema(schema) ? toJsonSchema(schema) : schema
}

const standardJsonSchema = (schema: StandardSchemaV1<any, any>, io: "input" | "output"): JsonSchema.JsonSchema => {
  if (isStandardJSONSchema(schema)) return schema["~standard"].jsonSchema[io]({ target: "draft-2020-12" })
  if (schema instanceof $ZodType) return toJSONSchema(schema, { target: "draft-2020-12", io })
  throw new Error(`Schema vendor "${schema["~standard"].vendor}" does not support JSON Schema conversion`)
}

const effectJsonSchemas = new WeakMap<object, JsonSchema.JsonSchema>()
const effectInputJsonSchemas = new WeakMap<object, JsonSchema.JsonSchema>()

const toJsonSchema = (schema: Schema.Top, input = false): JsonSchema.JsonSchema => {
  // Input schemas state a stricter contract than output schemas: see `refuseOptionalNulls`.
  const cache = input ? effectInputJsonSchemas : effectJsonSchemas
  const cached = cache.get(schema)
  if (cached) return structuredClone(cached)
  const document = Schema.toJsonSchemaDocument(schema)
  // Effect emits valid JSON Schema that some inference providers handle poorly. Simplify it
  // without changing validation: `{ type: "integer", allOf: [{ minimum: 0 }] }` becomes
  // `{ type: "integer", minimum: 0 }` only when no keyword would be overwritten. Named schemas
  // emit `$ref` plus root `$defs`; inline acyclic local references so providers receive the full
  // nested schema directly, then remove unused `$defs`. Recursive references stay intact because
  // expanding them would never terminate.
  const normalized = flattenAllOf(
    Object.keys(document.definitions).length === 0
      ? document.schema
      : { ...document.schema, $defs: document.definitions },
  )
  const inlined = dropDefinitionsIfResolved(inlineLocalReferences(normalized)) as JsonSchema.JsonSchema
  const result = input ? refuseOptionalNulls(inlined) : inlined
  cache.set(schema, result)
  return structuredClone(result)
}

const carriesNull = (schema: unknown): boolean => {
  if (!isRecord(schema)) return false
  if (schema.type === "null") return true
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true
  for (const keyword of ["anyOf", "oneOf"] as const) {
    const branches = schema[keyword]
    if (Array.isArray(branches) && branches.some(carriesNull)) return true
  }
  return false
}

/**
 * Effect emits `anyOf: [T, { type: "null" }]` for an optional property but its decoder rejects
 * null: only an absent key is optional. A provider reads that branch as permission to send
 * `{"id":null}` and every such call is refused for a reason the schema itself invited. Tool inputs
 * therefore state the decoder's contract: for a property the object does not require, drop the null
 * branch that optionality added. A genuinely nullable value keeps null, because it is either
 * required or its own schema still carries null without that branch.
 */
const refuseOptionalNulls = (value: unknown): JsonSchema.JsonSchema => {
  if (Array.isArray(value)) return value.map(refuseOptionalNulls) as unknown as JsonSchema.JsonSchema
  if (!isRecord(value)) return value as JsonSchema.JsonSchema
  const schema = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, refuseOptionalNulls(item)]),
  ) as Record<string, unknown>
  if (schema.type !== "object" || !isRecord(schema.properties)) return schema as JsonSchema.JsonSchema
  const required = Array.isArray(schema.required) ? schema.required.map(String) : []
  const properties = Object.fromEntries(
    Object.entries(schema.properties).map(([name, property]) => {
      if (required.includes(name) || !isRecord(property)) return [name, property]
      const branches = Array.isArray(property.anyOf) ? property.anyOf : undefined
      if (!branches) return [name, property]
      const kept = branches.filter((branch) => !(isRecord(branch) && branch.type === "null"))
      if (kept.length === branches.length || !kept.length) return [name, property]
      const { anyOf: _anyOf, ...rest } = property
      // One surviving branch is the whole field: `anyOf: [X, { type: "null" }]` reads as X. An
      // optional nullable value wraps its own nullable schema, so unwrapping leaves that null intact.
      const single = kept.length === 1 && isRecord(kept[0]) ? kept[0] : undefined
      if (single) {
        if (carriesNull(single)) return [name, { ...single, ...rest }]
        // `{ description: "..." }` beside the branch is documentation, not a constraint.
        const described = Object.keys(rest).every((key) => key === "description" || key === "title")
        return [name, described ? { ...single, ...rest } : { ...rest, anyOf: kept }]
      }
      // Several branches remain: keep them, since another branch may accept null on its own.
      return [name, { ...rest, anyOf: kept }]
    }),
  )
  return { ...schema, properties } as JsonSchema.JsonSchema
}

const flattenAllOf = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(flattenAllOf)
  if (typeof value !== "object" || value === null) return value

  const schema = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, flattenAllOf(item)]))
  if (!Array.isArray(schema.allOf) || !schema.allOf.every(isRecord) || !canFlattenAllOf(schema.allOf, schema))
    return schema
  const { allOf, ...rest } = schema
  return flattenAllOf({ ...Object.assign({}, ...allOf), ...rest })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const canFlattenAllOf = (allOf: ReadonlyArray<Record<string, unknown>>, parent: Record<string, unknown>) => {
  const keys = new Set(Object.keys(parent).filter((key) => key !== "allOf"))
  return allOf.every((item) =>
    Object.keys(item).every((key) => {
      if (keys.has(key)) return false
      keys.add(key)
      return true
    }),
  )
}

const inlineLocalReferences = (
  value: unknown,
  definitions?: Record<string, unknown>,
  seen = new Set<string>(),
): unknown => {
  if (Array.isArray(value)) return value.map((item) => inlineLocalReferences(item, definitions, seen))
  if (!isRecord(value)) return value

  const localDefinitions = definitions ?? (isRecord(value.$defs) ? value.$defs : undefined)
  if (typeof value.$ref === "string" && localDefinitions) {
    const segment = value.$ref.match(/^#\/\$defs\/([^/]+)$/)?.[1]
    const name = segment?.replaceAll("~1", "/").replaceAll("~0", "~")
    if (name && !seen.has(name)) {
      const target = localDefinitions[name]
      if (target) {
        const { $ref: _, ...rest } = value
        const resolvedTarget = inlineLocalReferences(target, localDefinitions, new Set(seen).add(name))
        const resolvedSiblings = inlineLocalReferences(rest, localDefinitions, seen)
        if (!isRecord(resolvedTarget) || !isRecord(resolvedSiblings)) return resolvedTarget
        if (canMergeRecords(resolvedTarget, resolvedSiblings)) return { ...resolvedTarget, ...resolvedSiblings }
        return { allOf: [resolvedTarget, resolvedSiblings] }
      }
    }
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, inlineLocalReferences(item, localDefinitions, seen)]),
  )
}

const canMergeRecords = (left: Record<string, unknown>, right: Record<string, unknown>) =>
  Object.keys(left).every((key) => !(key in right))

const dropDefinitionsIfResolved = (value: unknown): unknown => {
  if (!isRecord(value) || hasLocalReference(value)) return value
  const { $defs: _, ...rest } = value
  return rest
}

const hasLocalReference = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasLocalReference)
  if (!isRecord(value)) return false
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/$defs/")) return true
  return Object.values(value).some(hasLocalReference)
}

export const normalizeContent = (value: string | ReadonlyArray<Tool.Content> | undefined, output?: unknown) => {
  if (typeof value === "string") return [{ type: "text" as const, text: value }]
  if (value !== undefined && value.length > 0) return [...value]
  return [{ type: "text" as const, text: stringify(output) }]
}

const stringify = (value: unknown) => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export const normalizedName = (tool: Tool.Info) => tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")

export const effectiveName = (tool: Tool.Info) =>
  tool.options?.namespace === undefined
    ? normalizedName(tool)
    : `${tool.options.namespace.replaceAll(".", "_")}_${normalizedName(tool)}`
