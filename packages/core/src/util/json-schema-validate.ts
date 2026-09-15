export * as JsonSchemaValidate from "./json-schema-validate"

import { Ajv, type ValidateFunction } from "ajv"

/**
 * Validates tool arguments against a JSON Schema published by an adapter (an MCP server's
 * `inputSchema`). Validation fails open: a schema Ajv cannot compile (an unsupported draft, a
 * dangling `$ref`) validates nothing rather than making the tool uncallable.
 */

const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, logger: false })
const compiled = new WeakMap<object, ValidateFunction | null>()

export type Problem = {
  /** JSON Pointer-like path into the input, `input` for the root, e.g. `input.labels[0]`. */
  readonly path: string
  readonly message: string
}

const MAX_PROBLEMS = 5

function compile(schema: object): ValidateFunction | null {
  const cached = compiled.get(schema)
  if (cached !== undefined) return cached
  // `$schema` names a meta-schema Ajv may not have loaded (draft 2020-12); the keywords MCP
  // servers use validate the same under the default draft.
  const { $schema: _meta, $id: _id, ...rest } = schema as Record<string, unknown>
  let validate: ValidateFunction | null
  try {
    validate = ajv.compile(rest)
  } catch {
    validate = null
  }
  compiled.set(schema, validate)
  return validate
}

function pathOf(instancePath: string, missing?: string) {
  const segments = instancePath
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
  if (missing !== undefined) segments.push(missing)
  return segments.reduce(
    (path, segment) => (/^\d+$/.test(segment) ? `${path}[${segment}]` : `${path}.${segment}`),
    "input",
  )
}

/** Problems with `value` against `schema`; empty when it is valid or the schema cannot be compiled. */
export function problems(schema: unknown, value: unknown): Problem[] {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return []
  const validate = compile(schema)
  if (!validate || validate(value)) return []
  const seen = new Set<string>()
  const out: Problem[] = []
  for (const error of validate.errors ?? []) {
    const params = error.params as Record<string, unknown>
    const missing = error.keyword === "required" ? String(params.missingProperty) : undefined
    const extra = error.keyword === "additionalProperties" ? String(params.additionalProperty) : undefined
    const path = pathOf(error.instancePath, missing ?? extra)
    const message =
      missing !== undefined
        ? "is required"
        : extra !== undefined
          ? "is not an accepted property"
          : error.keyword === "enum" && Array.isArray(params.allowedValues)
            ? `must be one of ${params.allowedValues.map((item) => JSON.stringify(item)).join(", ")}`
            : (error.message ?? "is invalid")
    const key = `${path} ${message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ path, message })
    if (out.length >= MAX_PROBLEMS) break
  }
  return out
}

/** One line per problem, e.g. `input.owner is required; input.state must be one of "open", "closed"`. */
export function describe(found: readonly Problem[]) {
  return found.map((problem) => `${problem.path} ${problem.message}`).join("; ")
}
