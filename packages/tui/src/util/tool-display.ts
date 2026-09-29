export function canonicalToolName(name: string) {
  if (name === "bash") return "shell"
  if (name === "task") return "subagent"
  if (name === "apply_patch") return "patch"
  return name
}

export function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return
  return value
}

export function primitiveInputSummary(input: Record<string, unknown>, omit: readonly string[] = []) {
  const entries = Object.entries(input).filter(([key, value]) => {
    if (omit.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (entries.length === 0) return ""
  return `[${entries.map(([key, value]) => `${key}=${String(value)}`).join(", ")}]`
}

export type ExecuteCall = { tool: string; status: "running" | "completed" | "error"; input?: Record<string, unknown> }

export function executeCalls(value: unknown): ExecuteCall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((call) => {
    if (!isRecord(call)) return []
    const tool = call.tool
    const status = call.status
    if (typeof tool !== "string" || (status !== "running" && status !== "completed" && status !== "error")) return []
    return [{ tool, status, input: isRecord(call.input) ? call.input : undefined }]
  })
}

export function executeCallSummary(call: ExecuteCall) {
  const args = primitiveInputSummary(call.input ?? {}).replace(/\s+/g, " ")
  return `${call.tool}${args ? ` ${args}` : ""}`
}

export function webSearchProviderName(provider: unknown) {
  if (typeof provider !== "string" || !provider) return ""
  if (provider === "opencode") return "OpenCode"
  return `${provider[0].toUpperCase()}${provider.slice(1)}`
}

export function webSearchProviderLabel(provider: unknown) {
  const name = webSearchProviderName(provider)
  return name ? `Web Search via ${name}` : "Web Search"
}

export function toolDisplayMetadata(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {}
  if (!("status" in state) || state.status === "streaming") return {}
  if (!("metadata" in state) || !state.metadata || typeof state.metadata !== "object") return {}
  if (Array.isArray(state.metadata)) return {}
  return state.metadata as Record<string, unknown>
}

/**
 * What a created design shows in the transcript, read from the design_document result's metadata: the
 * chip naming the settled target and design system ("iOS app · DS: shadcn/ui (packages/ui)") and the
 * design-system identification's one-line result. Undefined for any other call.
 */
export function designDocumentChip(part: SessionMessageAssistantTool) {
  if (part.name !== "design_document" || part.state.status !== "completed") return undefined
  const metadata = toolDisplayMetadata(part.state)
  const chip = metadata.designChip
  if (typeof chip !== "string" || !chip.trim()) return undefined
  // The chip ends with how to change it, which is addressed to the agent.
  const at = chip.indexOf(" — ")
  const system = metadata.designSystem
  return {
    title: at < 0 ? chip : chip.slice(0, at),
    system: typeof system === "string" && system.trim() ? system : undefined,
  }
}

export function toolDisplayContent(state: SessionMessageAssistantTool["state"]) {
  if (state.status === "streaming" || state.status === "running") return []
  return state.content ?? []
}

export function nonEmptyToolContent<T>(content: ReadonlyArray<T> | undefined): [T, ...T[]] | undefined {
  if (!content) return undefined
  const [first, ...rest] = content
  return first === undefined ? undefined : [first, ...rest]
}
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { isRecord } from "./record"
