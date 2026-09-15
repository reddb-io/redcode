export * as JsonSchemaValidate from "./json-schema-validate"

import { Ajv, type ValidateFunction } from "ajv"

/**
 * Validates tool arguments against a JSON Schema published by an adapter (an MCP server's
 * `inputSchema`). Validation fails open: a schema Ajv cannot compile (an unsupported draft, a
 * dangling `$ref`), or one too large to compile cheaply, validates nothing rather than making the
 * tool uncallable.
 *
 * Server-supplied regular expressions (`pattern`, `patternProperties`) are stripped before compiling:
 * Ajv would run them as plain `RegExp`s on the event loop, where a catastrophic pattern from a
 * misbehaving server could hang the process. Their constraints go unchecked (fail open).
 */

/** Modes for callers that let validation be relaxed: refuse, log and call anyway, or skip. */
export type Mode = "strict" | "warn" | "off"

/** Schemas above this serialized size are not compiled. */
export const MAX_SCHEMA_BYTES = 256 * 1024

const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, logger: false })
const compiled = new WeakMap<object, ValidateFunction | null>()
let compilations = 0

export type Problem = {
  /** Path into the input, `input` for the root, e.g. `input.labels[0]`. */
  readonly path: string
  readonly message: string
}

const MAX_PROBLEMS = 5

/** How many schemas have been compiled in this process; for tests that check caching. */
export function compileCount() {
  return compilations
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A copy without `pattern` and `patternProperties`, keeping every other keyword. */
function withoutPatterns(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPatterns)
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  const hadPatternProperties = isRecord(value.patternProperties)
  for (const [key, item] of Object.entries(value)) {
    if (key === "pattern" && typeof item === "string") continue
    if (key === "patternProperties") continue
    // Without the pattern-matched properties, a closed object would refuse keys the server allows.
    if (key === "additionalProperties" && hadPatternProperties && item === false) continue
    // `properties` maps names to schemas: a property literally named "pattern" must survive.
    out[key] =
      key === "properties" && isRecord(item)
        ? Object.fromEntries(Object.entries(item).map(([name, schema]) => [name, withoutPatterns(schema)]))
        : withoutPatterns(item)
  }
  return out
}

function compile(schema: object): ValidateFunction | null {
  const cached = compiled.get(schema)
  if (cached !== undefined) return cached
  let validate: ValidateFunction | null = null
  let size = Infinity
  try {
    size = JSON.stringify(schema)?.length ?? Infinity
  } catch {
    // Circular or otherwise unserializable: not a schema worth compiling.
  }
  if (size <= MAX_SCHEMA_BYTES) {
    // `$schema` names a meta-schema Ajv may not have loaded (draft 2020-12); the keywords MCP
    // servers use validate the same under the default draft. `$id` would register globally.
    const { $schema: _meta, $id: _id, ...rest } = withoutPatterns(schema) as Record<string, unknown>
    try {
      compilations++
      validate = ajv.compile(rest)
      // Ajv keeps every compiled schema; the WeakMap above is the cache, so do not let it grow.
      ajv.removeSchema(rest)
    } catch {
      validate = null
    }
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

/**
 * Problems with `value` against `schema`; empty when it is valid or the schema is not validated.
 * Pass the same schema object each time: compiled validators are cached by identity.
 */
export function problems(schema: unknown, value: unknown): Problem[] {
  if (!isRecord(schema)) return []
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
