import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { announcedOrdinals } from "@opencode/util/design-round-summary"

/** Revision numbers (R7) the session's own design_preview and design_history results announced. */
export function designOrdinals(messages: readonly SessionMessageInfo[]) {
  return announcedOrdinals(
    messages
      .flatMap((message) => (message.type === "assistant" ? message.content : []))
      .filter((content): content is SessionMessageAssistantTool => content.type === "tool"),
  )
}
