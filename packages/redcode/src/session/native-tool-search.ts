import { anthropic } from "@ai-sdk/anthropic"
import { openai } from "@ai-sdk/openai"
import { APICallError, type ModelMessage, type Tool as AITool } from "ai"
import { LLMError } from "@reddb-io/redcode-llm"
import type { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import type { Provider } from "@/provider/provider"
import { isRecord } from "@/util/record"
import { ToolSearch } from "./tool-search"

/**
 * Provider-native tool search. Where the provider can load deferred definitions itself, every
 * deferred tool is sent flagged `defer_loading` next to the provider's search tool, and our
 * client-side `tool_search` is not advertised. The provider keeps deferred definitions out of the
 * cached prefix and loads matches at the end of the context, so loading a tool no longer rewrites
 * the tools block (client-side search appends to it, which re-bills everything after it).
 *
 * - Anthropic Messages (`@ai-sdk/anthropic`, both runtimes): `tool_search_tool_bm25_20251119`.
 * - OpenAI Responses (`@ai-sdk/openai`, AI SDK runtime only): hosted `tool_search`, deferred
 *   functions grouped in one namespace per MCP server.
 * - Everything else keeps the client-side `tool_search`.
 */

export type Mode = "anthropic" | "openai"

/** The provider search tool's key in the tools map, which is also the name its parts persist under. */
export const TOOL: Record<Mode, string> = { anthropic: "tool_search_tool_bm25", openai: "tool_search" }
const NAMES: Record<Mode, ReadonlySet<string>> = {
  anthropic: new Set(["tool_search_tool_bm25", "tool_search_tool_regex"]),
  openai: new Set(["tool_search"]),
}

// The models Anthropic lists for the tool search tool; dated snapshots match by prefix.
const ANTHROPIC_MODELS = [
  "claude-fable-5",
  "claude-mythos-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
]

/** The protocol that can carry native search for this model, whatever the model itself supports. */
function mechanism(model: Provider.Model, nativeLlm: boolean): Mode | undefined {
  if (model.api.npm === "@ai-sdk/anthropic") return "anthropic"
  // The native openai-responses adapter does not pass namespaces or the hosted search tool.
  if (model.api.npm === "@ai-sdk/openai" && !nativeLlm) return "openai"
  return undefined
}

/**
 * The explicit allowlist `auto` uses; the models catalog has no tool search capability to read.
 * An id outside it (a bracketed variant such as `[1m]` included) stays off unless forced.
 */
export function supported(model: Pick<Provider.Model, "providerID" | "api">, mode: Mode) {
  const id = model.api.id
  if (mode === "anthropic")
    return (
      model.providerID === "anthropic" &&
      ANTHROPIC_MODELS.some((prefix) => id === prefix || id.startsWith(prefix + "-"))
    )
  const version = /^gpt-(\d+)(?:\.(\d+))?(?:$|-)/.exec(id)
  if (model.providerID !== "openai" || !version) return false
  const major = Number(version[1])
  return major > 5 || (major === 5 && Number(version[2] ?? 0) >= 4)
}

const rejected = new Set<string>()
const key = (model: Pick<Provider.Model, "providerID" | "id">) => `${model.providerID}/${model.id}`

/** Remember for the rest of the process that this model's provider refused native search. */
export function reject(model: Pick<Provider.Model, "providerID" | "id">) {
  rejected.add(key(model))
}

export function isRejected(model: Pick<Provider.Model, "providerID" | "id">) {
  return rejected.has(key(model))
}

/** Test hook: forget every rejection. */
export function reset() {
  rejected.clear()
}

/**
 * Whether this step uses native search: `native: false` (or tool search off) never, `true` whenever
 * the provider package can carry it, `auto` (default) only for allowlisted models. A provider that
 * rejected it earlier in the process turns it off.
 */
export function detect(input: {
  readonly model: Provider.Model
  readonly config?: ToolSearch.Config
  readonly nativeLlm?: boolean
}): Mode | undefined {
  const setting = input.config?.native ?? "auto"
  if (setting === false || input.config?.enabled === false || isRejected(input.model)) return undefined
  const mode = mechanism(input.model, input.nativeLlm ?? false)
  if (!mode) return undefined
  return setting === true || supported(input.model, mode) ? mode : undefined
}

/** The mode `SessionTools` chose for this step's tools, unless the provider has rejected it since. */
export function modeOf(tools: Record<string, AITool>, model: Provider.Model) {
  const mode = ToolSearch.nativeOf(tools)
  return mode && !isRejected(model) ? mode : undefined
}

const deferOptions = (mode: Mode, namespace: string | undefined) =>
  mode === "anthropic"
    ? { anthropic: { deferLoading: true } }
    : {
        openai: {
          deferLoading: true,
          // One namespace per MCP server (or `design`); the description must be the same for every
          // tool in it.
          ...(namespace ? { namespace: { name: namespace, description: `Tools from ${namespace}.` } } : {}),
        },
      }

// The provider packages build tools against their own copy of provider-utils, whose schema symbol
// differs from the one `ai` checks at the type level; the runtime shape is the same.
const providerTool = (mode: Mode) =>
  (mode === "anthropic" ? anthropic.tools.toolSearchBm25_20251119() : openai.tools.toolSearch()) as unknown as AITool

/**
 * The AI SDK tools for a native search step: the provider search tool takes `tool_search`'s place
 * (so the order stays put) and every deferred tool is advertised with its defer flag.
 */
export function aiSdk(tools: Record<string, AITool>, mode: Mode) {
  const deferred = new Set(ToolSearch.deferredNames(tools))
  const next: Record<string, AITool> = {}
  for (const [name, item] of Object.entries(tools)) {
    if (name === ToolSearch.TOOL_ID) {
      next[TOOL[mode]] = providerTool(mode)
      continue
    }
    next[name] = deferred.has(name)
      ? ({
          ...item,
          providerOptions: { ...item.providerOptions, ...deferOptions(mode, ToolSearch.deferredNamespace(item)) },
        } as unknown as AITool)
      : item
  }
  const active = [
    ...ToolSearch.activeNames(tools).filter((name) => name !== ToolSearch.TOOL_ID),
    ...deferred,
    TOOL[mode],
  ]
  return { tools: next, active }
}

/** Deferred tools to send flagged and the names to advertise, for the native LLM runtime. */
export function native(tools: Record<string, AITool>) {
  const deferred = ToolSearch.deferredNames(tools)
  return {
    deferred,
    advertise: [...ToolSearch.activeNames(tools).filter((name) => name !== ToolSearch.TOOL_ID), ...deferred],
  }
}

export function isSearchPart(tool: string, providerExecuted: boolean | undefined) {
  return providerExecuted === true && (NAMES.anthropic.has(tool) || NAMES.openai.has(tool))
}

// ---------------------------------------------------------------- search results
// A search result is stored and replayed in one of three shapes: the AI SDK's Anthropic shape
// (`[{ type: "tool_reference", toolName }]`), Anthropic's wire block content
// (`{ tool_references: [{ tool_name }] }`), or OpenAI's `{ tools: [function | namespace] }`, whose
// namespaces nest their functions.

const referenceName = (reference: unknown) => {
  if (!isRecord(reference)) return undefined
  const name = reference.toolName ?? reference.tool_name
  return typeof name === "string" ? name : undefined
}

/** OpenAI's loaded tool entries kept by `keep`, namespaces reduced to their kept functions. */
function keepTools(tools: readonly unknown[], keep: (name: string) => boolean): unknown[] {
  return tools.flatMap((item) => {
    if (!isRecord(item)) return []
    if (item.type === "namespace") {
      const inner = Array.isArray(item.tools) ? keepTools(item.tools, keep) : []
      return inner.length > 0 ? [{ ...item, tools: inner }] : []
    }
    return typeof item.name === "string" && keep(item.name) ? [item] : []
  })
}

/** The result with only the tools `keep` accepts; `undefined` when nothing is left. */
function keepLoaded(value: unknown, keep: (name: string) => boolean): unknown {
  if (Array.isArray(value)) {
    const kept = value.filter((reference) => {
      const name = referenceName(reference)
      return name !== undefined && keep(name)
    })
    return kept.length > 0 ? kept : undefined
  }
  if (isRecord(value) && Array.isArray(value.tool_references)) {
    const kept = value.tool_references.filter((reference) => {
      const name = referenceName(reference)
      return name !== undefined && keep(name)
    })
    return kept.length > 0 ? { ...value, tool_references: kept } : undefined
  }
  if (isRecord(value) && Array.isArray(value.tools)) {
    const kept = keepTools(value.tools, keep)
    return kept.length > 0 ? { ...value, tools: kept } : undefined
  }
  return undefined
}

/** The tool names a search result loaded (never namespace names). */
export function loadedNames(value: unknown) {
  const names: string[] = []
  keepLoaded(value, (name) => {
    names.push(name)
    return true
  })
  return names
}

const parse = (text: string) => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/**
 * History for a step. Native search parts from another mode (or all of them when native search is
 * off) are dropped, and so is any search that failed, was interrupted, or has no JSON result,
 * because neither provider accepts a search call whose result cannot be replayed. A kept result is
 * narrowed to the tools this request still sends: Anthropic answers 400 to a `tool_reference` it
 * cannot resolve, and OpenAI (with `store: false`) would re-send the stored definition of a tool
 * that has since been removed or denied. A search that found nothing is kept; one whose loaded
 * tools are all gone is dropped. Search calls are provider-executed tool calls; their results pair
 * with them by id.
 */
export function history(
  messages: ModelMessage[],
  mode: Mode | undefined,
  available: ReadonlySet<string>,
): ModelMessage[] {
  const searches = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== "assistant" || typeof message.content === "string") continue
    for (const part of message.content)
      if (part.type === "tool-call" && part.providerExecuted === true && isSearchPart(part.toolName, true))
        searches.set(part.toolCallId, part.toolName)
  }
  if (searches.size === 0) return messages
  const drop = new Set<string>()
  for (const [id, name] of searches) if (!mode || !NAMES[mode].has(name)) drop.add(id)
  const narrowed = new Map<string, unknown>()
  const answered = new Set<string>()
  for (const message of messages) {
    if (message.role !== "assistant" || typeof message.content === "string") continue
    for (const part of message.content) {
      if (part.type !== "tool-result" || !searches.has(part.toolCallId)) continue
      answered.add(part.toolCallId)
      if (part.output.type !== "json") {
        drop.add(part.toolCallId)
        continue
      }
      // A search that found nothing stays as the provider saw it; only one whose every loaded
      // tool is gone is dropped.
      if (loadedNames(part.output.value).length === 0) continue
      const kept = keepLoaded(part.output.value, (name) => available.has(name))
      if (kept === undefined) drop.add(part.toolCallId)
      else if (JSON.stringify(kept) !== JSON.stringify(part.output.value)) narrowed.set(part.toolCallId, kept)
    }
  }
  for (const id of searches.keys()) if (!answered.has(id)) drop.add(id)
  if (drop.size === 0 && narrowed.size === 0) return messages
  return messages.flatMap((message): ModelMessage[] => {
    if (message.role !== "assistant" || typeof message.content === "string") return [message]
    type Part = (typeof message.content)[number]
    let changed = false
    const content: Part[] = []
    for (const part of message.content) {
      if (part.type !== "tool-call" && part.type !== "tool-result") {
        content.push(part)
        continue
      }
      if (drop.has(part.toolCallId)) {
        changed = true
        continue
      }
      if (part.type === "tool-result" && narrowed.has(part.toolCallId)) {
        changed = true
        content.push({ ...part, output: { type: "json", value: narrowed.get(part.toolCallId) as never } })
        continue
      }
      content.push(part)
    }
    if (!changed) return [message]
    return content.length === 0 ? [] : [{ ...message, content }]
  })
}

/** Tool names the replayed history calls, so a fallback step can still advertise them. */
export function called(messages: readonly ModelMessage[]) {
  const names = new Set<string>()
  for (const message of messages)
    if (message.role === "assistant" && typeof message.content !== "string")
      for (const part of message.content) if (part.type === "tool-call") names.add(part.toolName)
  return names
}

/**
 * The retry after a rejection sends the client-side `tool_search`, so the deferred tool index in
 * the system context must say so rather than point at a provider search tool.
 */
export function clientHint(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      const content = ToolSearch.clientIndexLead(message.content)
      return content === message.content ? message : ({ ...message, content } as ModelMessage)
    }
    if (message.role === "tool") return message
    let changed = false
    const content = message.content.map((part) => {
      if (part.type !== "text") return part
      const text = ToolSearch.clientIndexLead(part.text)
      if (text === part.text) return part
      changed = true
      return { ...part, text }
    })
    return changed ? ({ ...message, content } as ModelMessage) : message
  })
}

/**
 * Tools a native search loaded in this Session. Calling one does not move it out of the deferred
 * set: the provider already expands it from the search result, and advertising it up front would
 * rewrite the cached tools block.
 */
export function referenced(messages: readonly SessionV1.WithParts[]) {
  const names = new Set<string>()
  for (const message of messages)
    for (const part of message.parts) {
      if (part.type !== "tool" || part.state.status !== "completed") continue
      if (!isSearchPart(part.tool, part.metadata?.providerExecuted === true)) continue
      for (const name of loadedNames(parse(part.state.output))) names.add(name)
    }
  return names
}

/**
 * A stored search result as the replayed tool output. Both runtimes replay the AI SDK's shape
 * (`[{ type: "tool_reference", toolName }]` for Anthropic, `{ tools }` for OpenAI), so a result the
 * native runtime stored as the wire block content is converted.
 */
export function replayOutput(output: string): unknown {
  const parsed = parse(output)
  if (parsed === undefined) return output
  if (isRecord(parsed) && Array.isArray(parsed.tool_references))
    return parsed.tool_references.flatMap((reference) => {
      const name = referenceName(reference)
      return name === undefined ? [] : [{ type: "tool_reference", toolName: name }]
    })
  return parsed
}

const MISSING_REFERENCE = /Tool reference '[^']*' not found in available tools/i

// Only errors about the search feature itself: its tool types, the deferral flag and its parameter
// paths, a reference the provider cannot resolve, or OpenAI refusing the `tool_search`/`namespace`
// tool type value. Generic words (a beta, "namespace", "tool type", a bare `tool_search`, which is
// also our client-side tool's name) appear in unrelated 400s that a retry without search would not
// fix.
const REJECTIONS = [
  /tool_search_tool_(?:bm25|regex)/i,
  MISSING_REFERENCE,
  /defer_loading/i,
  /tool_reference/i,
  /tools\[\d+\]\.(?:namespace|tools)\b/i,
  /Invalid value: ['"](?:tool_search|namespace)['"]/,
]

const failure = (error: unknown): { status?: number; text: string } | undefined => {
  if (APICallError.isInstance(error))
    return { status: error.statusCode, text: `${error.message} ${error.responseBody ?? ""}` }
  if (error instanceof LLMError) {
    const http = "http" in error.reason ? error.reason.http : undefined
    return { status: http?.response?.status, text: `${error.reason.message} ${http?.body ?? ""}` }
  }
  return undefined
}

/** A 400 about the search feature: the provider (or this history) cannot use native search. */
export function isRejection(error: unknown) {
  const info = failure(error)
  return info?.status === 400 && REJECTIONS.some((pattern) => pattern.test(info.text))
}

/**
 * A reference the provider cannot resolve comes from this Session's history, not from missing
 * support: retry without native search, but do not turn it off for the model.
 */
export function isMissingReference(error: unknown) {
  const info = failure(error)
  return info?.status === 400 && MISSING_REFERENCE.test(info.text)
}

export * as NativeToolSearch from "./native-tool-search"
