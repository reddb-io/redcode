export * as PromptCacheDiagnostics from "./prompt-cache-diagnostics"

import type { LLMRequest } from "@reddb-io/redcode-llm"
import { Hash } from "../util/hash"

// Explains prompt cache misses: each provider request of a session is reduced to hashes of its
// cache-relevant components, in the order providers cache them (settings, tools, system, messages),
// and compared with the previous request of the same session. Only hashes are kept, for a bounded
// number of sessions.

interface Entry {
  readonly label: string
  readonly hash: string
}

export interface Snapshot {
  readonly settings: string
  readonly tools: ReadonlyArray<Entry>
  readonly system: ReadonlyArray<Entry>
  readonly messages: ReadonlyArray<Entry>
}

/** A request reduced to the parts a prompt cache keys on, whatever runtime built it. */
export interface Components {
  readonly settings: unknown
  readonly tools: ReadonlyArray<{ readonly label: string; readonly value: unknown }>
  readonly system: ReadonlyArray<unknown>
  readonly messages: ReadonlyArray<{ readonly label: string; readonly value: unknown }>
}

export type Component = "settings" | "tools" | "system" | "messages"

export type Comparison =
  | { readonly status: "initial" }
  | { readonly status: "stable"; readonly messages: number }
  | { readonly status: "append-only"; readonly previousMessages: number; readonly currentMessages: number }
  | { readonly status: "changed"; readonly component: Component; readonly index: number; readonly label: string }

// Binary payloads (images, files) are hashed on their own instead of being serialized byte by byte.
function hash(value: unknown) {
  return Hash.fast(
    // The holder's own value, before `toJSON` turns a Buffer into an array of numbers.
    JSON.stringify(value, function (this: Record<string, unknown>, key: string, current: unknown) {
      const raw = this[key]
      return raw instanceof Uint8Array
        ? `bytes:${Hash.fast(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength))}`
        : current
    }) ?? "",
  )
}

export function snapshot(components: Components): Snapshot {
  return {
    settings: hash(components.settings),
    tools: components.tools.map((tool) => ({ label: tool.label, hash: hash(tool.value) })),
    system: components.system.map((part, index) => ({ label: `system[${index}]`, hash: hash(part) })),
    messages: components.messages.map((message) => ({ label: message.label, hash: hash(message.value) })),
  }
}

/** The components of a V2 runner request. Request headers carry per-turn routing hints, not cached bytes. */
export function fromRequest(request: LLMRequest): Components {
  return {
    settings: {
      route: request.model.route.id,
      provider: request.model.provider,
      model: request.model.id,
      modelDefaults: request.model.defaults,
      compatibility: request.model.compatibility,
      routeDefaults: {
        generation: request.model.route.defaults.generation,
        providerOptions: request.model.route.defaults.providerOptions,
        http: request.model.route.defaults.http,
      },
      generation: request.generation,
      providerOptions: request.providerOptions,
      http: { body: request.http?.body, query: request.http?.query },
      toolChoice: request.toolChoice,
      responseFormat: request.responseFormat,
      cache: request.cache,
    },
    tools: request.tools.map((tool) => ({ label: tool.name, value: tool })),
    system: request.system,
    messages: request.messages.map((message, index) => ({
      label: message.id ?? `${message.role}[${index}]`,
      value: message,
    })),
  }
}

export function compare(previous: Snapshot | undefined, current: Snapshot): Comparison {
  if (!previous) return { status: "initial" }
  if (previous.settings !== current.settings)
    return { status: "changed", component: "settings", index: 0, label: "model settings" }
  const tools = firstChange(previous.tools, current.tools, false)
  if (tools) return { status: "changed", component: "tools", ...tools }
  const system = firstChange(previous.system, current.system, false)
  if (system) return { status: "changed", component: "system", ...system }
  const messages = firstChange(previous.messages, current.messages, true)
  if (messages) return { status: "changed", component: "messages", ...messages }
  if (previous.messages.length === current.messages.length)
    return { status: "stable", messages: current.messages.length }
  return {
    status: "append-only",
    previousMessages: previous.messages.length,
    currentMessages: current.messages.length,
  }
}

/** `initial`, `stable`, `append-only` or `changed:<component>`, for a one-word log field. */
export function classify(comparison: Comparison) {
  return comparison.status === "changed" ? `changed:${comparison.component}` : comparison.status
}

/**
 * Compares each request with the previous one under the same key (a session) and returns flat log
 * fields. Keys are evicted least recently used first, so memory stays bounded however many sessions
 * a process serves.
 */
export function tracker(limit = 100) {
  const snapshots = new Map<string, Snapshot>()
  return (key: string, components: Components) => {
    const current = snapshot(components)
    const comparison = compare(snapshots.get(key), current)
    snapshots.delete(key)
    snapshots.set(key, current)
    const oldest = snapshots.keys().next()
    if (snapshots.size > limit && !oldest.done) snapshots.delete(oldest.value)
    return {
      cache: classify(comparison),
      component: comparison.status === "changed" ? comparison.component : undefined,
      index: comparison.status === "changed" ? comparison.index : undefined,
      label: comparison.status === "changed" ? comparison.label : undefined,
      previousMessages: comparison.status === "append-only" ? comparison.previousMessages : undefined,
      tools: current.tools.length,
      systemParts: current.system.length,
      messages: current.messages.length,
    }
  }
}

function firstChange(previous: ReadonlyArray<Entry>, current: ReadonlyArray<Entry>, allowAppend: boolean) {
  const index = previous.findIndex((entry, index) => entry.hash !== current[index]?.hash)
  if (index >= 0) return { index, label: current[index]?.label ?? previous[index]?.label ?? `entry[${index}]` }
  if (current.length === previous.length || (allowAppend && current.length > previous.length)) return
  return { index: previous.length, label: current[previous.length]?.label ?? `entry[${previous.length}]` }
}
