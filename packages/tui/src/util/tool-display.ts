export function webSearchProviderLabel(provider: unknown) {
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa") return "Exa Web Search"
  return "Web Search"
}

/** Client-side `tool_search` and the provider-native search tools share one compact row. */
export const TOOL_SEARCH_TOOLS = new Set(["tool_search", "tool_search_tool_bm25", "tool_search_tool_regex"])

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

function loadedCount(output: string | undefined) {
  if (!output) return undefined
  const parsed = (() => {
    try {
      return JSON.parse(output) as unknown
    } catch {
      return undefined
    }
  })()
  if (Array.isArray(parsed)) return parsed.length
  const value = record(parsed)
  if (Array.isArray(value?.tool_references)) return value.tool_references.length
  if (Array.isArray(value?.tools)) return value.tools.length
  return undefined
}

/**
 * What a tool search asked for and how many tools it loaded, across the client-side tool
 * (`query`/`select`, `metadata.loaded`), Anthropic (`query` or `pattern`, tool references) and
 * OpenAI (`arguments`, loaded tools).
 */
export function toolSearchSummary(input: Record<string, unknown>, metadata: Record<string, unknown>, output?: string) {
  const args = record(input.arguments) ?? input
  const text = [args.query, args.pattern, args.goal].find((value): value is string => typeof value === "string")
  const list = [input.select, args.paths].find((value): value is unknown[] => Array.isArray(value))
  const query = text ?? list?.filter((item) => typeof item === "string").join(", ")
  const loaded = Array.isArray(metadata.loaded) ? metadata.loaded.length : loadedCount(output)
  return { query: query || undefined, loaded }
}

export function toolDisplayMetadata(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {}
  if (!("status" in state) || state.status === "pending") return {}
  if (!("structured" in state) || !state.structured || typeof state.structured !== "object") return {}
  if (Array.isArray(state.structured)) return {}
  return state.structured as Record<string, unknown>
}
