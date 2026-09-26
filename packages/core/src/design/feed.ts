export * as DesignFeed from "./feed.js"

import { Design } from "@opencode/schema/design"
import type { SessionEvent } from "@opencode/schema/session-event"
import { Option, Schema, Stream } from "effect"
import { Session } from "../session.js"
import { SessionSchema } from "../session/schema.js"
import { DesignFeedback } from "./feedback.js"

export const LIMITS = { text: 12000, summary: 240 } as const

const SUMMARY_FIELDS = ["name", "filePath", "path", "command", "pattern", "query", "description", "id"] as const
const Verified = Schema.Array(
  Schema.Struct({
    design: Design.ID,
    revision: Schema.String,
    round: Schema.Int,
    job: Schema.String,
    notes: Schema.Array(
      Schema.Struct({
        feedback: Schema.String,
        index: Schema.Int,
        label: Schema.String,
        verdict: Schema.Literals(["pass", "warn", "fail"]),
        reason: Schema.String,
      }),
    ),
  }),
)
const decodeVerified = Schema.decodeUnknownOption(Verified)

export function bound(text: string, limit: number) {
  const value = text.trim()
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

export function describe(text: string) {
  const notice = DesignFeedback.summarize(text)
  if (!notice) return { text: bound(text, LIMITS.text), notes: 0 }
  return {
    text: bound(notice.text.trim() || (notice.operation ? `Variant operation: ${notice.operation}` : ""), LIMITS.text),
    notes: notice.notes.length,
  }
}

export function summarize(input: Readonly<Record<string, unknown>>) {
  const field = SUMMARY_FIELDS.find((name) => typeof input[name] === "string" && String(input[name]).trim())
  return field ? bound(String(input[field]), LIMITS.summary) : ""
}

interface Call {
  name: string
  input: Readonly<Record<string, unknown>>
}

export interface State {
  readonly calls: ReadonlyMap<string, Call>
  readonly users: ReadonlyMap<string, ReturnType<typeof describe>>
  readonly announced: ReadonlySet<string>
}

export const initial: State = { calls: new Map(), users: new Map(), announced: new Set() }

/** Reduce one durable V2 Session event into the review's conversation vocabulary. */
export function reduce(state: State, event: SessionEvent.DurableEvent): readonly [State, ReadonlyArray<Design.FeedEvent>] {
  const base = { seq: event.durable.seq, at: event.created }
  if (event.type === "session.inbox.enqueued" && event.data.item.type === "user") {
    const summary = describe(event.data.item.payload.text)
    return [
      { ...state, users: new Map(state.users).set(event.data.inboxID, summary) },
      [{ ...base, type: "user", id: event.data.inboxID, ...summary, pending: true }],
    ]
  }
  if (event.type === "session.inbox.delivered") {
    const summary = state.users.get(event.data.inboxID)
    return [state, summary ? [{ ...base, type: "user", id: event.data.inboxID, ...summary }] : []]
  }
  if (event.type === "session.execution.started") return [state, [{ ...base, type: "state", state: "working" }]]
  if (
    event.type === "session.execution.succeeded" ||
    event.type === "session.execution.failed" ||
    event.type === "session.execution.interrupted"
  )
    return [state, [{ ...base, type: "state", state: "idle" }]]
  if (event.type === "session.text.ended") {
    const text = bound(event.data.text, LIMITS.text)
    return [state, text ? [{ ...base, type: "reply", id: `${event.data.assistantMessageID}:${event.data.ordinal}`, text }] : []]
  }
  if (event.type === "session.tool.input.started")
    return [
      { ...state, calls: new Map(state.calls).set(event.data.id, { name: event.data.name, input: {} }) },
      [],
    ]
  if (event.type === "session.tool.called") {
    const previous = state.calls.get(event.data.id)
    const call = { name: previous?.name ?? "", input: event.data.input }
    return [
      { ...state, calls: new Map(state.calls).set(event.data.id, call) },
      [{ ...base, type: "tool", id: event.data.id, tool: call.name, status: "running", summary: summarize(call.input) }],
    ]
  }
  if (event.type === "session.tool.success") {
    const call = state.calls.get(event.data.id)
    const metadata = event.data.metadata
    const design = metadata?.designID
    const revision = metadata?.revision
    const published =
      call?.name === "design_preview" && typeof design === "string" && Schema.is(Design.ID)(design) &&
      typeof revision === "string"
        ? [{ ...base, type: "published" as const, design, revision, name: String(call.input.name ?? "") }]
        : []
    const verified = call?.name === "design_jobs"
      ? Option.getOrElse(decodeVerified(metadata?.verified), () => [])
          .filter((item) => !state.announced.has(item.job))
          .map((item) => ({
            ...base,
            type: "verified" as const,
            ...item,
            notes: item.notes.map((note) => ({
              ...note,
              label: bound(note.label, LIMITS.summary),
              reason: bound(note.reason, LIMITS.summary),
            })),
          }))
      : []
    return [
      verified.length ? { ...state, announced: new Set([...state.announced, ...verified.map((item) => item.job)]) } : state,
      [
        { ...base, type: "tool", id: event.data.id, tool: call?.name ?? "", status: "done", summary: summarize(call?.input ?? {}) },
        ...published,
        ...verified,
      ],
    ]
  }
  if (event.type === "session.tool.failed")
    return [
      state,
      [{
        ...base,
        type: "tool",
        id: event.data.id,
        tool: state.calls.get(event.data.id)?.name ?? "",
        status: "failed",
        summary: bound(event.data.error.message, LIMITS.summary),
      }],
    ]
  if (event.type === "session.agent.selected") return [state, [{ ...base, type: "agent", agent: event.data.agent }]]
  return [state, []]
}

/** Replay from the beginning to reconstruct call and inbox state, then emit from the requested cursor. */
export function follow(sessions: Session.Interface, sessionID: SessionSchema.ID, after = 0) {
  return sessions.log({ sessionID, follow: true }).pipe(
    Stream.filter((event): event is SessionEvent.DurableEvent => event.type !== "log.synced"),
    Stream.mapAccum(
      () => initial,
      (state, event) => {
        const [next, entries] = reduce(state, event)
        return [next, entries.filter((entry) => entry.seq > after)] as const
      },
    ),
  )
}
