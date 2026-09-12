export * as DesignFeed from "./feed"

import { DateTime, Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { SessionEvent } from "../session/event"
import { DesignFeedback } from "./feedback"

/** Bounds on one feed entry; the transcript keeps the full content. */
export const LIMITS = { text: 12000, summary: 240 } as const

/** The tool whose success means a new revision the review page should load. */
export const PREVIEW_TOOL = "design_preview"

const SUMMARY_FIELDS = ["name", "filePath", "path", "command", "pattern", "query", "description", "id"] as const

export function bound(text: string, limit: number) {
  const value = text.trim()
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}…`
}

/** What the feed shows for a prompt: a browser review collapses to its message and note count. */
export function describe(text: string) {
  const notice = DesignFeedback.summarize(text)
  if (!notice) return bound(text, LIMITS.text)
  return describeNotice(notice)
}

export function describeNotice(notice: Pick<Design.FeedbackNotice, "text" | "notes">) {
  const count = notice.notes.length
  return (
    [bound(notice.text, LIMITS.text), count ? `${count} ${count === 1 ? "note" : "notes"}` : ""]
      .filter(Boolean)
      .join(" · ") || "Review"
  )
}

/** One line about a tool call, taken from its most descriptive input field. */
export function summarize(input: Record<string, unknown>) {
  const field = SUMMARY_FIELDS.find((name) => typeof input[name] === "string" && String(input[name]).trim())
  return field ? bound(String(input[field]), LIMITS.summary) : ""
}

/** The revision a design_preview result names, or nothing when the result is not a revision. */
export function revisionOf(structured: Record<string, unknown>) {
  const id = structured.id
  const design = structured.designID
  if (typeof id !== "string" || !id || typeof design !== "string" || !Schema.is(Design.ID)(design)) return undefined
  return { design, revision: id, name: typeof structured.name === "string" ? structured.name : "" }
}

/** Tool calls seen so far, so a result can be attributed to the tool that produced it. */
export interface State {
  readonly calls: ReadonlyMap<string, string>
}

export const initial: State = { calls: new Map() }

/** Reduce one durable Session event into feed entries. Pure: the handler threads the state. */
export function reduce(
  state: State,
  event: SessionEvent.DurableEvent,
): readonly [state: State, events: ReadonlyArray<Design.FeedEvent>] {
  const base = { seq: event.durable?.seq ?? 0, at: DateTime.toEpochMillis(event.data.timestamp) }
  if (event.type === "session.next.prompt.admitted" || event.type === "session.next.prompted")
    return [state, [{ ...base, type: "user", id: event.data.messageID, text: describe(event.data.prompt.text) }]]
  if (event.type === "session.next.text.ended") {
    const text = bound(event.data.text, LIMITS.text)
    return [state, text ? [{ ...base, type: "reply", id: event.data.textID, text }] : []]
  }
  if (event.type === "session.next.tool.called")
    return [
      { calls: new Map(state.calls).set(event.data.callID, event.data.tool) },
      [
        {
          ...base,
          type: "tool",
          id: event.data.callID,
          tool: event.data.tool,
          status: "running",
          summary: summarize(event.data.input),
        },
      ],
    ]
  if (event.type === "session.next.tool.success") {
    const tool = state.calls.get(event.data.callID) ?? ""
    const published = tool === PREVIEW_TOOL ? revisionOf(event.data.structured) : undefined
    return [
      state,
      [
        {
          ...base,
          type: "tool",
          id: event.data.callID,
          tool,
          status: "done",
          summary: bound(
            typeof event.data.structured.title === "string" ? event.data.structured.title : "",
            LIMITS.summary,
          ),
        },
        ...(published ? [{ ...base, type: "published" as const, ...published }] : []),
      ],
    ]
  }
  if (event.type === "session.next.tool.failed")
    return [
      state,
      [
        {
          ...base,
          type: "tool",
          id: event.data.callID,
          tool: state.calls.get(event.data.callID) ?? "",
          status: "failed",
          summary: bound(event.data.error.message, LIMITS.summary),
        },
      ],
    ]
  if (event.type === "session.next.agent.switched")
    return [state, [{ ...base, type: "agent", agent: event.data.agent }]]
  return [state, []]
}
