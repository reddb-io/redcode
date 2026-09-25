/**
 * What a created design shows in the transcript, read from the design_document result's metadata:
 * the chip naming the settled target and design system ("iOS app · DS: shadcn/ui (packages/ui)"),
 * how to change either, and the design-system identification's one-line result (kind, paths,
 * confidence, who decided it, unverified). Undefined for any other design_document call.
 */
export function designDocumentSummary(metadata: Record<string, unknown> | undefined) {
  const chip = metadata?.designChip
  if (typeof chip !== "string") return undefined
  const [title, change] = chip.split(" — ")
  const system = metadata?.designSystem
  return {
    title: title!,
    change: change?.replace(/^change:\s*/, ""),
    system: typeof system === "string" && system.trim() ? system : undefined,
  }
}
