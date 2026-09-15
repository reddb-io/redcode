import { Effect, Schema } from "effect"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  tool: Schema.String,
  error: Schema.String,
})

const UNKNOWN = "Unknown tool "

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

/**
 * What the model reads after calling a tool that does not exist. The AI SDK's own message lists
 * every tool name, which with a few MCP servers is kilobytes on every miss; the closest names are
 * what a retry needs.
 */
export function unknownToolMessage(name: string, available: ReadonlyArray<string>) {
  const lower = name.toLowerCase()
  const score = (candidate: string) => {
    const other = candidate.toLowerCase()
    const shared = other.startsWith(lower) || lower.startsWith(other) || other.endsWith(lower) || lower.endsWith(other)
    return distance(lower, other) - (shared ? Math.min(lower.length, other.length) : 0)
  }
  const nearest = available
    .filter((candidate) => candidate !== "invalid")
    .map((candidate) => ({ candidate, score: score(candidate) }))
    .toSorted((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
    .slice(0, 3)
    .map((item) => item.candidate)
  // TODO(tool_search): once tool_search ships, point the model at it for tools it cannot see.
  return (
    `${UNKNOWN}'${name.slice(0, 80)}'.` +
    (nearest.length ? ` Closest: ${nearest.join(", ")}.` : "") +
    " Check the tool name; available tools are listed in your tool definitions."
  )
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
