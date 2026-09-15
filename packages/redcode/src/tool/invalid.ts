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
 * what a retry needs. `available` must be the tools the model can call in this request;
 * `deferred` are tools behind tool_search, which are ranked too and, when one is among the
 * closest, the message says to load it with tool_search. Never exceeds UNKNOWN_TOOL_MAX_BYTES.
 */
export function unknownToolMessage(
  name: string,
  available: ReadonlyArray<string>,
  options: { deferred?: ReadonlyArray<string> } = {},
) {
  const lower = name.slice(0, 200).toLowerCase()
  const score = (candidate: string) => {
    const other = candidate.toLowerCase()
    const shared = other.startsWith(lower) || lower.startsWith(other) || other.endsWith(lower) || lower.endsWith(other)
    return distance(lower, other) - (shared ? Math.min(lower.length, other.length) : 0)
  }
  const deferred = new Set(options.deferred ?? [])
  const nearest = [...available, ...deferred]
    .filter((candidate) => candidate !== "invalid")
    .map((candidate) => ({ candidate, score: score(candidate) }))
    .toSorted((a, b) => a.score - b.score || (a.candidate < b.candidate ? -1 : 1))
    .slice(0, 3)
    .map((item) => ({ name: clip(item.candidate, 64), deferred: deferred.has(item.candidate) }))
  const render = (names: typeof nearest) => {
    const load = names.find((item) => item.deferred)
    return (
      `${UNKNOWN}'${clip(name, 64)}'.` +
      (names.length ? ` Closest: ${names.map((item) => item.name).join(", ")}.` : "") +
      (load ? ` Load one with tool_search {"select": ["${load.name}"]}.` : HINT)
    )
  }
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
