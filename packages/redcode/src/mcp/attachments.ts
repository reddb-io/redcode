export * as McpAttachments from "./attachments"

/**
 * What binary MCP content may become a model-visible attachment. Shared by direct MCP calls and
 * calls made from a code mode script, so a script cannot pass through media a direct call refuses.
 */

export const MAX_BYTES = 10 * 1024 * 1024
export const SUPPORTED_MIMES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

export function base64Size(value: string) {
  const trimmed = value.replace(/\s/g, "")
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${Math.ceil(value / (1024 * 1024))} MB`
}

/**
 * Why a binary block cannot be attached, as the text that replaces it, or undefined when it can.
 * `label` names the content, e.g. the resource URI.
 */
export function refusal(input: { label: string; mime: string; base64: string }) {
  const size = base64Size(input.base64)
  if (!SUPPORTED_MIMES.has(input.mime))
    return `[Binary MCP resource omitted: ${input.label} (${input.mime}, ${formatBytes(size)}) is not a supported attachment type]`
  if (size > MAX_BYTES)
    return `[Binary MCP resource omitted: ${input.label} (${input.mime}, ${formatBytes(size)}) exceeds ${formatBytes(MAX_BYTES)}]`
  return undefined
}
