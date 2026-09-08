import type { JsonSchema } from "effect"

export interface MediaCapability {
  readonly operations: readonly ("generate" | "edit" | "reference")[]
  readonly formats: readonly string[]
  readonly transparency: boolean
}

export interface ToolSpec {
  readonly description: string
  readonly inputSchema: JsonSchema.JsonSchema
  readonly media?: MediaCapability
  readonly execute: (
    input: unknown,
    context: { sessionID: string; signal: AbortSignal },
  ) => Promise<{
    content: readonly ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]
    isError?: boolean
  }>
}
