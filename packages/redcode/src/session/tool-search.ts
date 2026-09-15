import { Search } from "@reddb-io/redcode-codemode"
import type { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import type { Tool as AITool } from "ai"

/**
 * Progressive discovery for the default (non code mode) tool path. Deferred tools stay in the
 * AI SDK `tools` map, so a call to one still validates and runs through the ordinary execute
 * path, but they are left out of `activeTools`, which is what the SDK sends to the provider.
 * `tool_search` lists them compactly and loads them; the loaded set is derived from history, so
 * it only grows within a Session (a compaction, which rewrites the prefix anyway, resets it).
 */

export const TOOL_ID = "tool_search"
export const DEFAULT_THRESHOLD = 3000
export const DESIGN_NAMESPACE = "design"

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 20
const INDEX_NAMES_PER_NAMESPACE = 40
const PARAMS_SHOWN = 8

export type Config = {
  readonly enabled?: "auto" | boolean
  readonly threshold?: number
}

export type Entry = {
  /** The callable tool name, e.g. `github_issue_read`. */
  readonly name: string
  /** MCP server name or `design`. */
  readonly namespace: string
  readonly description: string
  readonly schema: Record<string, unknown>
}

const DEFERRED = Symbol.for("redcode.tool-search.deferred")
const GUIDANCE = Symbol.for("redcode.tool-search.guidance")

type Marked = AITool & { [DEFERRED]?: true; [GUIDANCE]?: string }

/** The namespace a flat MCP tool key belongs to; the longest matching server name wins. */
export function namespaceOf(key: string, servers: readonly string[]) {
  const server = [...servers].sort((a, b) => b.length - a.length).find((name) => key.startsWith(name + "_"))
  if (server) return server
  return key.includes("_") ? key.slice(0, key.indexOf("_")) : key
}

const localName = (entry: Entry) =>
  entry.name.startsWith(entry.namespace + "_") ? entry.name.slice(entry.namespace.length + 1) : entry.name

/** chars/4 over what the provider would receive for these definitions. */
export function estimateTokens(entries: readonly Entry[]) {
  const chars = entries.reduce(
    (total, entry) => total + entry.name.length + entry.description.length + JSON.stringify(entry.schema).length,
    0,
  )
  return Math.ceil(chars / 4)
}

/**
 * Which tools to defer. MCP tools are deferred as one group once their schemas exceed the
 * threshold (or always with `enabled: true`); Design tools are deferred whenever the Session has
 * no Design context, because outside one they are never the next step.
 */
export function plan(input: {
  readonly config?: Config
  readonly mcp: readonly Entry[]
  readonly design: readonly Entry[]
  readonly designContext: boolean
}): Entry[] {
  const enabled = input.config?.enabled ?? "auto"
  if (enabled === false) return []
  const threshold = input.config?.threshold ?? DEFAULT_THRESHOLD
  const mcp = enabled === true || estimateTokens(input.mcp) > threshold ? input.mcp : []
  return [...mcp, ...(input.designContext ? [] : input.design)]
}

/**
 * Tools loaded so far in this Session: every deferred tool the history already calls (so a
 * replayed call always refers to an advertised tool) plus everything `tool_search` loaded.
 */
export function loadedFromHistory(messages: readonly SessionV1.WithParts[], names: ReadonlySet<string>) {
  const loaded = new Set<string>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool") continue
      if (names.has(part.tool)) loaded.add(part.tool)
      if (part.tool !== TOOL_ID || part.state.status !== "completed") continue
      const listed = part.state.metadata?.loaded
      if (!Array.isArray(listed)) continue
      for (const name of listed) if (typeof name === "string" && names.has(name)) loaded.add(name)
    }
  }
  return loaded
}

function groups(entries: readonly Entry[]) {
  const byNamespace = new Map<string, Entry[]>()
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name)))
    byNamespace.set(entry.namespace, [...(byNamespace.get(entry.namespace) ?? []), entry])
  return [...byNamespace.entries()].sort(([a], [b]) => a.localeCompare(b))
}

/** Names only, grouped by namespace: `github (46): add_issue_comment, …`. */
export function index(entries: readonly Entry[]) {
  return groups(entries)
    .map(([namespace, items]) => {
      const names = items.slice(0, INDEX_NAMES_PER_NAMESPACE).map(localName)
      const more = items.length > names.length ? `, … +${items.length - names.length} more` : ""
      return `${namespace} (${items.length}): ${names.join(", ")}${more}`
    })
    .join("\n")
}

/**
 * The tool description carries the index so the listing lives in the tools section, which
 * already changes exactly when the set of connected tools does, and never in the system prompt
 * or the durable context baseline.
 */
export function description(entries: readonly Entry[]) {
  return [
    "Find and load tools that are available but not loaded yet. Their schemas are not in your tool list until loaded.",
    "- query: keywords matched against tool names, descriptions and parameters; returns the best matches and loads them.",
    '- select: exact tool names to load, e.g. ["' + entries[0]!.name + '"].',
    "Loaded tools are callable from your next step and stay loaded for the rest of the session.",
    "A tool's full name is <namespace>_<name> from the list below.",
    "",
    "Deferred tools:",
    index(entries),
  ].join("\n")
}

export function guidanceLine(entries: readonly Entry[]) {
  const namespaces = groups(entries).map(([namespace]) => namespace)
  return `Additional tools for ${namespaces.join(", ")} are available through ${TOOL_ID}. Example: ${TOOL_ID}({"query": "list open issues"}) or ${TOOL_ID}({"select": ["${entries[0]!.name}"]}).`
}

export const InputSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Keywords describing the tool you need, e.g. 'read issue comments'.",
    },
    select: {
      type: "array",
      items: { type: "string" },
      description: "Exact tool names to load, as listed in the tool description.",
    },
    limit: {
      type: "number",
      description: `Maximum matches for query (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}).`,
    },
  },
  additionalProperties: false,
} as const

function oneLine(text: string, max = 160) {
  const line = text.split("\n", 1)[0]!.trim()
  return line.length > max ? line.slice(0, max - 1) + "…" : line
}

function params(schema: Record<string, unknown>) {
  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {}
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  const names = Object.entries(properties as Record<string, Record<string, unknown>>).map(([name, value]) => {
    const type = typeof value?.type === "string" ? `: ${value.type}` : ""
    return `${name}${required.has(name) ? "*" : ""}${type}`
  })
  if (names.length === 0) return "none"
  const shown = names.slice(0, PARAMS_SHOWN)
  return shown.join(", ") + (names.length > shown.length ? `, +${names.length - shown.length} more` : "")
}

export function summary(entry: Entry) {
  return `${entry.name} — ${oneLine(entry.description) || "(no description)"}\n  params: ${params(entry.schema)}`
}

function candidates(entries: readonly Entry[]) {
  return entries.map((entry) => ({
    path: `${entry.namespace}.${localName(entry)}`,
    description: entry.description,
    searchText: [
      entry.name,
      entry.description,
      ...Object.entries((entry.schema.properties ?? {}) as Record<string, { description?: unknown }>).flatMap(
        ([name, value]) => (typeof value?.description === "string" ? [name, value.description] : [name]),
      ),
    ]
      .join("\n")
      .toLowerCase(),
    value: entry,
  }))
}

export function search(entries: readonly Entry[], query: string, limit = DEFAULT_LIMIT) {
  return Search.rank(candidates(entries), query)
    .slice(0, Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit))))
    .map((candidate) => candidate.value)
}

export type Result = {
  readonly title: string
  readonly output: string
  readonly metadata: { loaded: string[]; notFound: string[] }
}

/** Runs one `tool_search` call against the deferred entries; `active` names are already callable. */
export function run(
  entries: readonly Entry[],
  active: ReadonlySet<string>,
  args: { query?: unknown; select?: unknown; limit?: unknown },
): Result {
  const query = typeof args.query === "string" ? args.query.trim() : ""
  const select = Array.isArray(args.select)
    ? args.select.filter((name): name is string => typeof name === "string")
    : []
  if (!query && select.length === 0) throw new Error("Provide query (keywords) or select (exact tool names).")
  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  const found: Entry[] = []
  const notFound: string[] = []
  const already: string[] = []
  for (const name of select) {
    const entry = byName.get(name)
    if (entry) found.push(entry)
    else if (active.has(name)) already.push(name)
    else notFound.push(name)
  }
  const matched = query ? search(entries, query, typeof args.limit === "number" ? args.limit : DEFAULT_LIMIT) : []
  const loaded = [...new Map([...found, ...matched].map((entry) => [entry.name, entry])).values()]
  const lines: string[] = []
  if (loaded.length > 0)
    lines.push(
      `Loaded ${loaded.length} tool${loaded.length === 1 ? "" : "s"}, callable from your next step:`,
      ...loaded.map(summary),
    )
  else if (query) lines.push(`No deferred tool matches "${query}".`)
  if (already.length > 0) lines.push(`Already available: ${already.join(", ")}.`)
  for (const name of notFound) {
    const suggestions = search(entries, name, 3).map((entry) => entry.name)
    lines.push(`Unknown tool: ${name}.${suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : ""}`)
  }
  return {
    title: query ? `Tool search: ${query}` : `Load tools: ${select.join(", ")}`,
    output: lines.join("\n"),
    metadata: { loaded: loaded.map((entry) => entry.name), notFound },
  }
}

export function markDeferred(item: AITool): AITool {
  return { ...item, [DEFERRED]: true } as Marked
}

export function withGuidance(item: AITool, line: string): AITool {
  return { ...item, [GUIDANCE]: line } as Marked
}

export function isDeferred(item: AITool | undefined) {
  return (item as Marked | undefined)?.[DEFERRED] === true
}

/** The names to advertise: everything except `invalid` and tools that are still deferred. */
export function activeNames(tools: Record<string, AITool>) {
  return Object.keys(tools).filter((name) => name !== "invalid" && !isDeferred(tools[name]))
}

/** The one system line naming the deferred categories, when this step defers anything. */
export function guidance(tools: Record<string, AITool>) {
  return (tools[TOOL_ID] as Marked | undefined)?.[GUIDANCE]
}

export * as ToolSearch from "./tool-search"
