import type { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { ToolSearch as Core } from "@reddb-io/redcode-core/tool/tool-search"
import type { Tool as AITool } from "ai"

/**
 * Progressive discovery for the default (non code mode) tool path. Deferred tools stay in the
 * AI SDK `tools` map, so a call to one is still parsed and runs through the ordinary execute
 * path, but they are left out of `activeTools`, which is what the SDK sends to the provider.
 *
 * What to defer, how the index reads and what one search call answers live in
 * `@reddb-io/redcode-core/tool/tool-search`, shared with the v2 runner and re-exported below.
 * This module keeps the AI SDK bookkeeping and the V1 history readers, which read parts rather
 * than V2 messages.
 *
 * Cache shape: the `tool_search` description is static; the index of deferred tools lives in the
 * durable system context (`redcode/tool-index`), so a server connecting mid-session arrives as one
 * system update instead of rewriting the tools block. Loaded tools are advertised after every other
 * tool in activation order, derived from history, so the advertised list only grows at its end
 * within a Session (a compaction, which rewrites the prefix anyway, resets it).
 */

export const {
  TOOL_ID,
  DEFAULT_THRESHOLD,
  DESIGN_NAMESPACE,
  DESCRIPTION,
  InputSchema,
  namespaceOf,
  estimateTokens,
  plan,
  index,
  indexText,
  clientIndexLead,
  summary,
  search,
  run,
} = Core
export type Config = Core.Config
export type Entry = Core.Entry
export type Result = Core.Result

const DEFERRED = Symbol.for("redcode.tool-search.deferred")
const ACTIVATED = Symbol.for("redcode.tool-search.activated")
const INDEX = Symbol.for("redcode.tool-search.index")
const NATIVE = Symbol.for("redcode.tool-search.native")

type NativeMode = "anthropic" | "openai"
type Marked = AITool & {
  /** The namespace, or `true` when none was given. */
  [DEFERRED]?: string | true
  [ACTIVATED]?: number
  [INDEX]?: string
  [NATIVE]?: NativeMode
}

/**
 * Whether MCP deferral tripped earlier in this Session: a completed `tool_search` call in the
 * (post-compaction) history that ran while MCP tools were deferred. Design tools alone keep
 * `tool_search` present, so the call itself is not enough. A compaction resets it together with
 * the loaded set.
 */
export function trippedInHistory(messages: readonly SessionV1.WithParts[]) {
  return messages.some((message) =>
    message.parts.some(
      (part) =>
        (part.type === "compaction" && part.tools?.mcpDeferred === true) ||
        (part.type === "tool" &&
          part.tool === TOOL_ID &&
          part.state.status === "completed" &&
          part.state.metadata?.mcpDeferred === true),
    ),
  )
}

/** Names a compaction carries forward, at most this many. */
const MAX_CARRIED = 200

/**
 * What a compaction records so the loaded set survives it: every tool name loaded or called so far
 * (the next step keeps only the ones still deferred), and whether MCP deferral had tripped.
 */
export function carried(messages: readonly SessionV1.WithParts[]) {
  const names = new Set<string>()
  for (const message of messages)
    for (const part of message.parts) {
      if (part.type === "compaction") for (const name of part.tools?.loaded ?? []) names.add(name)
      if (part.type !== "tool") continue
      if (part.tool !== TOOL_ID && part.tool !== "invalid") names.add(part.tool)
      const listed = part.state.status === "completed" ? part.state.metadata?.loaded : undefined
      if (part.tool === TOOL_ID && Array.isArray(listed))
        for (const name of listed) if (typeof name === "string") names.add(name)
    }
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
  messages: readonly SessionV1.WithParts[],
  names: ReadonlySet<string>,
  /** Tools a provider-native search loaded: calling one leaves it deferred. */
  natively?: ReadonlySet<string>,
) {
  const seen: Array<{ name: string; at: number; order: number }> = []
  for (const message of messages) {
    for (const part of message.parts) {
      // A compaction carries what was loaded before it, ahead of anything loaded after.
      if (part.type === "compaction")
        for (const name of part.tools?.loaded ?? [])
          if (names.has(name)) seen.push({ name, at: message.info.time.created, order: seen.length })
      if (part.type !== "tool") continue
      const at = "time" in part.state ? part.state.time.start : message.info.time.created
      if (names.has(part.tool) && !natively?.has(part.tool)) seen.push({ name: part.tool, at, order: seen.length })
      if (part.tool !== TOOL_ID || part.state.status !== "completed") continue
      const listed = part.state.metadata?.loaded
      if (!Array.isArray(listed)) continue
      for (const name of listed)
        if (typeof name === "string" && names.has(name)) seen.push({ name, at, order: seen.length })
    }
  }
  const ordered = seen.toSorted((a, b) => a.at - b.at || a.order - b.order).map((item) => item.name)
  return [...new Set(ordered)]
}

export function markDeferred(item: AITool, namespace?: string): AITool {
  return { ...item, [DEFERRED]: namespace ?? true } as Marked
}

/** The namespace a deferred tool was marked with. */
export function deferredNamespace(item: AITool | undefined) {
  const value = (item as Marked | undefined)?.[DEFERRED]
  return typeof value === "string" ? value : undefined
}

/** Marks the `tool_search` entry with the provider-native search mode this step uses. */
export function withNative(item: AITool, mode: NativeMode | undefined): AITool {
  return mode ? ({ ...item, [NATIVE]: mode } as Marked) : item
}

export function nativeOf(tools: Record<string, AITool>) {
  return (tools[TOOL_ID] as Marked | undefined)?.[NATIVE]
}

/** A deferred tool that has been loaded; `rank` is its position in the Session's activation order. */
export function markActivated(item: AITool, rank: number): AITool {
  return { ...item, [ACTIVATED]: rank } as Marked
}

export function withIndex(item: AITool, text: string): AITool {
  return { ...item, [INDEX]: text } as Marked
}

export function isDeferred(item: AITool | undefined) {
  return (item as Marked | undefined)?.[DEFERRED] !== undefined
}

export function activation(item: AITool | undefined) {
  return (item as Marked | undefined)?.[ACTIVATED]
}

/** Loaded deferred tools in the order the Session activated them, for `orderTools`. */
export function activationOrder(tools: Record<string, AITool>) {
  return Object.keys(tools)
    .filter((name) => activation(tools[name]) !== undefined)
    .toSorted((a, b) => activation(tools[a])! - activation(tools[b])!)
}

/** Deferred tools that are not loaded yet: callable by exact name, not advertised. */
export function deferredNames(tools: Record<string, AITool>) {
  return Object.keys(tools).filter((name) => isDeferred(tools[name]))
}

/** The names to advertise: everything except `invalid` and tools that are still deferred. */
export function activeNames(tools: Record<string, AITool>) {
  return Object.keys(tools).filter((name) => name !== "invalid" && !isDeferred(tools[name]))
}

/** The deferred tool index for the system context, when this step defers anything. */
export function indexOf(tools: Record<string, AITool>) {
  return (tools[TOOL_ID] as Marked | undefined)?.[INDEX]
}

export * as ToolSearch from "./tool-search"
