import type { DesignInfo, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"

/** Where a design stands in its review: the same buckets the terminal's Design list shows. */
export function designStatus(design: Pick<DesignInfo, "revision" | "approvedRevision" | "ended">) {
  if (design.ended) return "closed" as const
  if (design.revision && design.approvedRevision === design.revision) return "approved" as const
  if (design.revision) return "review" as const
  return "draft" as const
}

/** The newest completed `design_preview` call, so the Design tab opens once per new preview. */
export function latestDesignPreview(messages: readonly SessionMessageInfo[]) {
  return messages
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .filter((content): content is SessionMessageAssistantTool => content.type === "tool")
    .findLast((tool) => tool.name === "design_preview" && tool.state.status === "completed")?.id
}

/**
 * Changes after which the session's designs are worth reading again: finished Design tool calls
 * and the prompts that record browser feedback or an approval.
 */
export function designActivity(messages: readonly SessionMessageInfo[]) {
  return messages.reduce((count, message) => {
    if (message.type === "assistant")
      return (
        count +
        message.content.filter(
          (content) =>
            content.type === "tool" && content.name.startsWith("design_") && content.state.status === "completed",
        ).length
      )
    if (message.type !== "user" && message.type !== "synthetic") return count
    const source = message.metadata?.source
    return source === "design.feedback" || source === "design.approval" ? count + 1 : count
  }, 0)
}
