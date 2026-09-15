import { Effect, Schema } from "effect"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  tool: Schema.String,
  error: Schema.String,
})

const UNKNOWN = "Unknown tool "
export const UNKNOWN_TOOL_MAX_BYTES = 300
const HINT = " Check the tool name; available tools are listed in your tool definitions."

function distance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    previous = current
  }
  return previous[b.length]
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

/**
 * What the model reads after calling a tool that does not exist. The AI SDK's own message lists
 * every tool name, which with a few MCP servers is kilobytes on every miss; the closest names are
 * what a retry needs. `available` must be the tools the model can call in this request.
 * The result never exceeds UNKNOWN_TOOL_MAX_BYTES.
 */
export function unknownToolMessage(name: string, available: ReadonlyArray<string>) {
  const lower = name.slice(0, 200).toLowerCase()
  const score = (candidate: string) => {
    const other = candidate.toLowerCase()
    const shared = other.startsWith(lower) || lower.startsWith(other) || other.endsWith(lower) || lower.endsWith(other)
    return distance(lower, other) - (shared ? Math.min(lower.length, other.length) : 0)
  }
  const nearest = available
    .filter((candidate) => candidate !== "invalid")
    .map((candidate) => ({ candidate, score: score(candidate) }))
    .toSorted((a, b) => a.score - b.score || (a.candidate < b.candidate ? -1 : 1))
    .slice(0, 3)
    .map((item) => clip(item.candidate, 64))
  // TODO(tool_search): PR B passes only active tools here and, when the name matches a deferred
  // MCP tool, says to load it with tool_search instead.
  const render = (names: string[]) =>
    `${UNKNOWN}'${clip(name, 64)}'.` + (names.length ? ` Closest: ${names.join(", ")}.` : "") + HINT
  let message = render(nearest)
  while (Buffer.byteLength(message) > UNKNOWN_TOOL_MAX_BYTES && nearest.length > 0) {
    nearest.pop()
    message = render(nearest)
  }
  return message
}

export const InvalidTool = Tool.define(
  "invalid",
  Effect.succeed({
    description: "Do not use",
    parameters: Parameters,
    execute: (params: { tool: string; error: string }) =>
      Effect.succeed({
        title: "Invalid Tool",
        output: params.error.startsWith(UNKNOWN)
          ? params.error
          : `The arguments provided to the tool are invalid: ${params.error}`,
        metadata: {},
      }),
  }),
)
