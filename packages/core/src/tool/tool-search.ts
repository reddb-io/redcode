export * as ToolSearch from "./tool-search"

// The `search` subpath, not the barrel: the barrel pulls acorn and the TypeScript compiler, and
// this module is reached from compaction, so every consumer would load them at startup.
import { DateTime } from "effect"
import * as Search from "@reddb-io/redcode-codemode/search"
import type { SessionMessage } from "../session/message"

/**
 * Progressive discovery of tools that are available but not advertised.
 *
 * This module is the runtime-agnostic half: which tools to defer, how the deferred index reads,
 * and what one search call answers. Both runtimes share it. The legacy loop keeps the AI SDK
 * bookkeeping (marking a `tools` map entry deferred or activated) and its own V1 history readers
 * in `redcode/src/session/tool-search.ts`, which re-exports everything here.
 *
 * Cache shape: the `tool_search` description is static; the index of deferred tools lives in the
 * durable system context (`redcode/tool-index`), so a server connecting mid-session arrives as one
 * system update instead of rewriting the tools block. Loaded tools are advertised after every other
 * tool in activation order, derived from history, so the advertised list only grows at its end
 * within a Session (a compaction, which rewrites the prefix anyway, resets it).
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
  /** Provider-native tool search where supported; see `NativeToolSearch.detect`. */
  readonly native?: "auto" | boolean
}

export type Entry = {
  /** The callable tool name, e.g. `github_issue_read`. */
  readonly name: string
  /** MCP server name or `design`. */
  readonly namespace: string
  readonly description: string
  readonly schema: Record<string, unknown>
}

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
  /**
   * Deferral already tripped in this Session. In auto mode it then stays on whatever the schema
   * size does, so servers hovering around the threshold do not move loaded tools between blocks.
   */
  readonly tripped?: boolean
}): Entry[] {
  const enabled = input.config?.enabled ?? "auto"
  if (enabled === false) return []
  const threshold = input.config?.threshold ?? DEFAULT_THRESHOLD
  const mcp = enabled === true || input.tripped || estimateTokens(input.mcp) > threshold ? input.mcp : []
  return [...mcp, ...(input.designContext ? [] : input.design)]
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

/** Static on purpose: it sits in the tools block, which must not change when servers do. */
export const DESCRIPTION = [
  "Find and load tools that are available but not loaded yet; the system context lists them by namespace. Their schemas are not in your tool list until loaded.",
  "- query: keywords matched against tool names, descriptions and parameters; returns the best matches and loads them.",
  '- select: exact tool names to load, e.g. ["github_issue_read"]. A tool\'s full name is <namespace>_<name>.',
  "Loaded tools are callable from your next step and stay loaded for the rest of the session.",
].join("\n")

/** The durable system context text: which categories are deferred, one example, and the index. */
const nativeLead = (namespaces: string) =>
  `Additional tools for ${namespaces} are available but not loaded. Find them with your tool search tool, which matches tool names, descriptions and parameters and loads the matches; a tool's full name is <namespace>_<name>.`

const clientLead = (namespaces: string, example: string) =>
  `Additional tools for ${namespaces} are available through ${TOOL_ID}. Example: ${TOOL_ID} {"query": "list open issues"} or ${TOOL_ID} {"select": ["${example}"]}.`

const NATIVE_LEAD = new RegExp(
  nativeLead("(.+?)")
    .replace(/[.*+?^${}()|[\]\\]/g, (char) => "\\" + char)
    .replace("\\(\\.\\+\\?\\)", "(.+?)"),
  "g",
)

/** The native index lead line rewritten for the client-side tool, for a request that falls back. */
export function clientIndexLead(text: string) {
  return text.replace(NATIVE_LEAD, (_match, namespaces: string) =>
    clientLead(namespaces, `${namespaces.split(", ")[0]}_<name>`),
  )
}

export function indexText(entries: readonly Entry[], native = false) {
  const namespaces = groups(entries).map(([namespace]) => namespace)
  return [
    native ? nativeLead(namespaces.join(", ")) : clientLead(namespaces.join(", "), entries[0]!.name),
    "<deferred_tools>",
    index(entries),
    "</deferred_tools>",
  ].join("\n")
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
      description: "Exact tool names to load, as <namespace>_<name> from the deferred tool list.",
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
  readonly metadata: { loaded: string[]; notFound: string[]; mcpDeferred: boolean }
}

/** Runs one `tool_search` call against the deferred entries; `active` names are already callable. */
export function run(
  entries: readonly Entry[],
  active: ReadonlySet<string>,
  args: { query?: unknown; select?: unknown; limit?: unknown },
): Result {
  const mcpDeferred = entries.some((entry) => entry.namespace !== DESIGN_NAMESPACE)
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
    metadata: { loaded: loaded.map((entry) => entry.name), notFound, mcpDeferred },
  }
}

// ---------------------------------------------------------------- v2 history

/** The `tool_search` result field that lists what one call loaded. */
const loadedNames = (structured: Readonly<Record<string, unknown>> | undefined) => {
  const listed = structured?.["loaded"]
  return Array.isArray(listed) ? listed.filter((name): name is string => typeof name === "string") : []
}

/**
 * Whether MCP deferral tripped earlier in this Session: a completed `tool_search` call in the
 * (post-compaction) history that ran while MCP tools were deferred. Design tools alone keep
 * `tool_search` present, so the call itself is not enough. A compaction resets it together with
 * the loaded set, and carries it forward in the compaction message.
 */
export function trippedInHistory(messages: readonly SessionMessage.Message[]) {
  return messages.some((message) => {
    if (message.type === "compaction") return message.tools?.mcpDeferred === true
    if (message.type !== "assistant") return false
    return message.content.some(
      (item) =>
        item.type === "tool" &&
        item.name === TOOL_ID &&
        item.state.status === "completed" &&
        item.state.structured?.["mcpDeferred"] === true,
    )
  })
}

/**
 * Every tool name this history mentions: called, or loaded through `tool_search`, or carried
 * across a compaction. `loadedFromHistory` keeps whichever of them are still deferred.
 */
export function namesInHistory(messages: readonly SessionMessage.Message[]) {
  const names = new Set<string>()
  for (const message of messages) {
    if (message.type === "compaction") for (const name of message.tools?.loaded ?? []) names.add(name)
    if (message.type !== "assistant") continue
    for (const item of message.content) {
      if (item.type !== "tool") continue
      if (item.name !== TOOL_ID) names.add(item.name)
      if (item.name === TOOL_ID && item.state.status === "completed")
        for (const name of loadedNames(item.state.structured)) names.add(name)
    }
  }
  return names
}

/** Names a compaction carries forward, at most this many. */
const MAX_CARRIED = 200

/**
 * What a compaction records so the loaded set survives it: every tool name loaded or called so far
 * (the next step keeps only the ones still deferred), and whether MCP deferral had tripped.
 */
export function carried(messages: readonly SessionMessage.Message[]) {
  const names = namesInHistory(messages)
  return {
    loaded: loadedFromHistory(messages, names).slice(-MAX_CARRIED),
    mcpDeferred: trippedInHistory(messages),
  }
}

/**
 * Tools loaded so far in this Session, in activation order: every deferred tool the history
 * already calls (so a replayed call always refers to an advertised tool) plus everything
 * `tool_search` loaded. Ordered by when the loading part started, not by array position, because
 * history is not chronological after a compaction.
 */
export function loadedFromHistory(
  messages: readonly SessionMessage.Message[],
  names: ReadonlySet<string>,
  /** Tools a provider-native search loaded: calling one leaves it deferred. */
  natively?: ReadonlySet<string>,
) {
  const seen: Array<{ name: string; at: number; order: number }> = []
  for (const message of messages) {
    // Epoch millis, not `Number(...)`: these are `DateTime.Utc` values, and coercing one directly
    // yields no usable ordering key, which silently collapsed activation order to insertion order.
    const created = message.time?.created === undefined ? 0 : DateTime.toEpochMillis(message.time.created)
    // A compaction carries what was loaded before it, ahead of anything loaded after.
    if (message.type === "compaction")
      for (const name of message.tools?.loaded ?? [])
        if (names.has(name)) seen.push({ name, at: created, order: seen.length })
    if (message.type !== "assistant") continue
    for (const item of message.content) {
      if (item.type !== "tool") continue
      const stamp = item.time?.ran ?? item.time?.created
      const at = stamp === undefined ? created : DateTime.toEpochMillis(stamp)
      if (names.has(item.name) && !natively?.has(item.name)) seen.push({ name: item.name, at, order: seen.length })
      if (item.name !== TOOL_ID || item.state.status !== "completed") continue
      for (const name of loadedNames(item.state.structured))
        if (names.has(name)) seen.push({ name, at, order: seen.length })
    }
  }
  const ordered = seen.toSorted((a, b) => a.at - b.at || a.order - b.order).map((item) => item.name)
  return [...new Set(ordered)]
}
