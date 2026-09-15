export * as NativeToolSearch from "./native-tool-search"

import type { Model } from "@reddb-io/redcode-llm"
import type { ToolSearch } from "./tool-search"

/**
 * Provider-native tool search for the v2 runner.
 *
 * Where the provider can load deferred definitions itself, every deferred tool is sent with
 * `deferLoading` next to the provider's own search tool, and the client-side `tool_search` is not
 * advertised. The provider keeps deferred definitions out of the cached prefix and loads matches at
 * the end of the context, so loading a tool no longer rewrites the tools block.
 *
 * Only the Anthropic Messages protocol carries this today: `@reddb-io/redcode-llm` lowers
 * `deferLoading` and the `tool_search_tool_bm25` tool from `providerOptions.anthropic.toolSearch`.
 * The OpenAI Responses protocol has no equivalent yet, so those models keep the client-side tool.
 */

export type Mode = "anthropic"

/** The route whose protocol can carry native search, whatever the model itself supports. */
const ANTHROPIC_ROUTE = "anthropic-messages"

/** The provider search tool's name, which is also the name its parts persist under. */
export const TOOL: Record<Mode, string> = { anthropic: "tool_search_tool_bm25" }

/** Names the provider executes itself; never settled locally, never replayed without their tool. */
export const NAMES: ReadonlySet<string> = new Set(["tool_search_tool_bm25", "tool_search_tool_regex"])

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

/**
 * The explicit allowlist `auto` uses; the models catalog has no tool search capability to read.
 * An id outside it (a bracketed variant such as `[1m]` included) stays off unless forced.
 */
export function supported(model: Pick<Model, "id" | "provider">) {
  const id = String(model.id)
  return (
    String(model.provider) === "anthropic" &&
    ANTHROPIC_MODELS.some((prefix) => id === prefix || id.startsWith(prefix + "-"))
  )
}

const rejected = new Set<string>()
const key = (model: Pick<Model, "id" | "provider">) => `${String(model.provider)}/${String(model.id)}`

/** Remember for the rest of the process that this model's provider refused native search. */
export function reject(model: Pick<Model, "id" | "provider">) {
  rejected.add(key(model))
}

export function isRejected(model: Pick<Model, "id" | "provider">) {
  return rejected.has(key(model))
}

/** Test hook: forget every rejection. */
export function reset() {
  rejected.clear()
}

/**
 * Whether this step uses native search: `native: false` (or tool search off) never, `true` whenever
 * the protocol can carry it, `auto` (default) only for allowlisted models. A provider that rejected
 * it earlier in the process turns it off.
 */
export function detect(input: { readonly model: Model; readonly config?: ToolSearch.Config }): Mode | undefined {
  const setting = input.config?.native ?? "auto"
  if (setting === false || input.config?.enabled === false || isRejected(input.model)) return undefined
  if (input.model.route.id !== ANTHROPIC_ROUTE) return undefined
  return setting === true || supported(input.model) ? "anthropic" : undefined
}
