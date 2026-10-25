export * as ConfigNormalize from "./normalize.js"

import { Schema, SchemaIssue, SchemaParser } from "effect"
import { Info } from "@opencode/schema/config"

export interface Diagnostic {
  readonly kind: "invalid"
  readonly path: readonly string[]
  readonly message: string
}

export type Result =
  | {
      readonly type: "normalized"
      readonly encoded: Readonly<Record<string, unknown>>
      readonly diagnostics: readonly Diagnostic[]
    }
  | { readonly type: "rejected"; readonly diagnostics: readonly Diagnostic[] }

const decode = SchemaParser.decodeUnknownResult(Info, { errors: "all", onExcessProperty: "error" })
const encode = Schema.encodeSync(Info)
const message =
  "Configuration does not match the current schema. Inspect older files with redcode migrate inspect --kind config before converting them to a new output file."
const formatter = SchemaIssue.makeFormatterStandardSchemaV1({ leafHook: () => message, checkHook: () => message })

export function normalize(input: unknown): Result {
  const info = decode(input)
  if (info._tag === "Success") return { type: "normalized", encoded: encode(info.success), diagnostics: [] }
  return {
    type: "rejected",
    diagnostics: formatter(info.failure).issues.map((issue) => ({
      kind: "invalid",
      path: issue.path?.length ? issue.path.map((part) => String(typeof part === "object" ? part.key : part)) : ["$"],
      message,
    })),
  }
}
