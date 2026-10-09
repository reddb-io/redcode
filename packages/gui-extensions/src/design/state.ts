import type { DesignInfo, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { designRoundSummary } from "@opencode/util/design-round-summary"
import { designReviewURL } from "@opencode/util/design-review"
import type { Live } from "../sdk"

/**
 * Opens a session's Design review beside it in the desktop's browser pane, at the review's stable address in its
 * simplified form, and says whether it did. It does not when a system browser has to show the review instead: the
 * pane is off, still loading, not on this platform (`Browser` is desktop only), or not attached to this session yet.
 */
export function openDesignReviewPane<
  Session extends { readonly id: string; readonly server: { readonly url: string } },
>(browser: Live<{ attached(session: Session): boolean; open(session: Session, url: string): void }>, session: Session) {
  if (browser.status !== "active" || !browser.value.attached(session)) return false
  browser.value.open(session, designReviewURL(session.server.url, session.id, { embed: true }))
  return true
}

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

// The order a compact note list reads in: what still needs work first, then what was settled.
const ATTENTION = { open: 0, unresolved: 1, partial: 2, accepted: 3, resolved: 4 } as const

/**
 * A design's review as the Design tab shows it, from the round projection every surface shares: the newest
 * round with its notes ordered by what needs attention, and how many notes of earlier rounds still have no
 * outcome. `revisions` is the design's revision list, newest first, for the revision numbers.
 */
export function designReview(
  design: Pick<DesignInfo, "revision" | "ended" | "endRequested" | "rounds" | "notes">,
  revisions?: ReadonlyArray<{ readonly id: string }>,
) {
  const summary = designRoundSummary(design, revisions)
  const round = summary.latest
  return {
    summary,
    round,
    earlier: summary.open - (round?.open ?? 0),
    notes: (round?.notes ?? []).toSorted((a, b) => ATTENTION[a.status] - ATTENTION[b.status]),
  }
}
