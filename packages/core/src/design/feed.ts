export * as DesignFeed from "./feed"

import { DateTime, Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { SessionEvent } from "../session/event"
import { DesignFeedback } from "./feedback"
import { DesignRounds } from "./rounds"

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

/** A review's feed text: its message, or the variant operation it requests when it has no message. */
export function reviewText(notice: { text: string; operation?: string }) {
  return bound(notice.text.trim() || (notice.operation ? `Variant operation: ${notice.operation}` : ""), LIMITS.text)
}

/** What the feed shows for a prompt: a browser review collapses to its message and its note count. */
export function describe(text: string) {
  const notice = DesignFeedback.summarize(text)
  if (!notice) return { text: bound(text, LIMITS.text), notes: 0 }
  return { text: reviewText(notice), notes: notice.notes.length }
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

/** The tool whose result carries finished jobs, among them a round's verify with its per-note verdicts. */
export const JOBS_TOOL = "design_jobs"

const decodeJob = Schema.decodeUnknownOption(Design.Job)

/**
 * One `verified` entry per completed verify job in a design_jobs result. The same job is reported by
 * every later design_jobs call too; the client merges repeats by job id. Jobs are read one by one, so
 * a malformed or foreign entry never hides the others.
 */
export function verifiedOf(jobs: unknown, base: { seq: number; at: number }): Design.FeedEvent[] {
  if (!Array.isArray(jobs)) return []
  return jobs.flatMap((item) => {
    const decoded = decodeJob(item)
    if (decoded._tag === "None") return []
    const job = decoded.value
    if (job.status !== "completed" || !job.verify) return []
    return [
      {
        ...base,
        type: "verified" as const,
        design: job.designID,
        revision: job.verify.revision,
        round: job.verify.round,
        job: job.id,
        notes: job.verify.notes.map((note) => ({
          feedback: note.feedback,
          index: note.index,
          label: bound(note.label, LIMITS.summary),
          verdict: DesignRounds.verdict(note),
          reason: bound(note.reason, LIMITS.summary),
        })),
      },
    ]
  })
}

/** Tool calls seen so far, so a result can be attributed to the tool that produced it. */
export interface State {
  readonly calls: ReadonlyMap<string, string>
  /** Verify jobs already announced, so a design_jobs poll does not repeat their entry. */
  readonly announced: ReadonlySet<string>
}

export const initial: State = { calls: new Map(), announced: new Set() }

/** Reduce one durable Session event into feed entries. Pure: the handler threads the state. */
export function reduce(
  state: State,
  event: SessionEvent.DurableEvent,
): readonly [state: State, events: ReadonlyArray<Design.FeedEvent>] {
  const base = { seq: event.durable?.seq ?? 0, at: DateTime.toEpochMillis(event.data.timestamp) }
  // An admitted prompt waits for a turn to take it up; the same entry is repeated without `pending` when one does.
  if (event.type === "session.next.prompt.admitted")
    return [
      state,
      [{ ...base, type: "user", id: event.data.messageID, ...describe(event.data.prompt.text), pending: true }],
    ]
  // A delivery change (`session.next.prompt.delivery`) says when a waiting prompt reaches the model,
  // not what it says. The feed's vocabulary is pending versus delivered, so there is nothing to add.
  if (event.type === "session.next.prompted")
    return [state, [{ ...base, type: "user", id: event.data.messageID, ...describe(event.data.prompt.text) }]]
  if (event.type === "session.next.text.ended") {
    const text = bound(event.data.text, LIMITS.text)
    return [state, text ? [{ ...base, type: "reply", id: event.data.textID, text }] : []]
  }
  if (event.type === "session.next.tool.called")
    return [
      { ...state, calls: new Map(state.calls).set(event.data.callID, event.data.tool) },
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
    const verified =
      tool === JOBS_TOOL
        ? verifiedOf(event.data.structured.jobs, base).filter(
            (entry) => entry.type === "verified" && !state.announced.has(entry.job),
          )
        : []
    const announced = verified.length
      ? new Set([...state.announced, ...verified.flatMap((entry) => (entry.type === "verified" ? [entry.job] : []))])
      : state.announced
    return [
      { ...state, announced },
      [
        {
          ...base,
          type: "tool",
          id: event.data.callID,
          tool,
          status: "done",
          summary: summarize(event.data.structured),
        },
        ...(published ? [{ ...base, type: "published" as const, ...published }] : []),
        ...verified,
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
