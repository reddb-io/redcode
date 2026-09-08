import type { Part } from "@reddb-io/redcode-sdk/v2/client"

/**
 * Which prototype the panel should show: the newest `design_preview` call that finished. Kept
 * apart from the component so it can be tested without a renderer.
 */
export function latestDesignPreview(messages: readonly { id: string }[], parts: (id: string) => Part[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const part of parts(messages[i]!.id)) {
      if (part.type !== "tool" || part.tool !== "design_preview") continue
      if (part.state.status !== "completed") continue
      const id = part.state.input.id
      if (typeof id !== "string" || !id.startsWith("design_")) continue
      return { id, name: part.state.title }
    }
  }
  return undefined
}
