export * as CodeModeGate from "./code-mode-gate"

import { Wildcard } from "@reddb-io/redcode-core/util/wildcard"

/**
 * Whether code mode replaces direct MCP tools for one request, and the limits a script runs under.
 *
 * `experimental.code_mode.enabled` is "off" by default. "auto" is capability gating: it turns code
 * mode on only for models an operator has vouched for (small models write poor scripts) and only
 * when the MCP schemas are large enough that sending them every request costs more than a script.
 * `REDCODE_EXPERIMENTAL_CODE_MODE=true` forces it on regardless, as before.
 */

export const TOOL_ID = "execute"

/**
 * Native tools a script may call under `tools.redcode`: read-only ones only. Writing, running
 * commands, delegating, asking the user and session bookkeeping stay direct calls, where the user
 * sees each one as its own step.
 */
export const SCRIPT_NATIVE_TOOLS: ReadonlySet<string> = new Set(["read", "glob", "grep", "webfetch"])

export type Config = {
  readonly enabled?: "off" | "auto" | "on"
  readonly models?: readonly string[]
  readonly threshold?: number
  readonly max_tool_calls?: number
  readonly timeout_ms?: number
  readonly max_output_bytes?: number
}

export const DEFAULT_THRESHOLD = 6000

export const DEFAULT_LIMITS = {
  maxToolCalls: 50,
  timeoutMs: 120_000,
  maxOutputBytes: 1_000_000,
} as const

export type Limits = { readonly maxToolCalls: number; readonly timeoutMs: number; readonly maxOutputBytes: number }

export function limits(config?: Config): Limits {
  return {
    maxToolCalls: config?.max_tool_calls ?? DEFAULT_LIMITS.maxToolCalls,
    timeoutMs: config?.timeout_ms ?? DEFAULT_LIMITS.timeoutMs,
    maxOutputBytes: config?.max_output_bytes ?? DEFAULT_LIMITS.maxOutputBytes,
  }
}

/** Matches `provider/model` or the bare model ID against each wildcard pattern. */
export function modelAllowed(models: readonly string[] | undefined, providerID: string, modelID: string) {
  if (!models || models.length === 0) return false
  const qualified = `${providerID}/${modelID}`
  return models.some((pattern) => Wildcard.match(qualified, pattern) || Wildcard.match(modelID, pattern))
}

type SchemaTool = {
  readonly def: { readonly name: string; readonly description?: string; readonly inputSchema: unknown }
}

/** chars/4 over what direct mode would send for these MCP tools, the same estimate tool_search uses. */
export function estimateTokens(mcpTools: Readonly<Record<string, SchemaTool>>) {
  const chars = Object.entries(mcpTools).reduce(
    (total, [key, tool]) =>
      total + key.length + (tool.def.description?.length ?? 0) + JSON.stringify(tool.def.inputSchema ?? {}).length,
    0,
  )
  return Math.ceil(chars / 4)
}

export function enabled(input: {
  readonly flag: boolean
  readonly config?: Config
  readonly providerID: string
  readonly modelID: string
  readonly mcpTools: Readonly<Record<string, SchemaTool>>
}) {
  if (input.flag) return true
  const mode = input.config?.enabled ?? "off"
  if (mode === "on") return true
  if (mode === "off") return false
  if (!modelAllowed(input.config?.models, input.providerID, input.modelID)) return false
  return estimateTokens(input.mcpTools) > (input.config?.threshold ?? DEFAULT_THRESHOLD)
}
