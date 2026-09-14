export * as DesignFeed from "./feed"

import { Context, Effect, Layer, Queue, Schema, Stream } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { SessionStatusEvent } from "@reddb-io/redcode-schema/session-status-event"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { DesignFeed } from "@reddb-io/redcode-core/design/feed"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Database } from "@reddb-io/redcode-core/database/database"
import { SessionInput } from "@reddb-io/redcode-core/session/input"
import { SessionSchema } from "@reddb-io/redcode-core/session/schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { MessageID, SessionID } from "@/session/schema"

/**
 * What the live reducer continues from. A V1 part update does not say whose message it belongs to,
 * and a user message is written when its prompt is admitted, before a turn takes it up.
 */
export interface State {
  readonly roles: ReadonlyMap<MessageID, "user" | "assistant">
  /** User messages a turn has taken up (Prompt Promotion); any other user message is still pending. */
  readonly promoted: ReadonlySet<MessageID>
  /** The latest entry of each user message, repeated without `pending` once it is promoted. */
  readonly users: ReadonlyMap<MessageID, Design.FeedEvent>
}

export const initial: State = { roles: new Map(), promoted: new Set(), users: new Map() }

const isPart = Schema.is(Schema.toType(SessionV1.Event.PartUpdated.data))
const isMessage = Schema.is(Schema.toType(SessionV1.Event.MessageUpdated.data))
const isPromoted = Schema.is(Schema.toType(SessionV1.Event.MessagePromoted.data))
const isSession = Schema.is(Schema.toType(SessionV1.Event.Updated.data))
const isStatus = Schema.is(Schema.toType(SessionStatusEvent.Status.data))
const isNotice = Schema.is(Design.FeedbackNotice)

/** Feed entries for one V1 part. Replay and live updates share this so both describe a part alike. */
export function part(
  role: "user" | "assistant" | undefined,
  item: typeof SessionV1.Part.Type,
  at: number,
  pending = false,
): Design.FeedEvent[] {
  const base = { seq: 0, at }
  if (item.type === "text" && role === "user" && !item.synthetic && !item.ignored) {
    const notice = item.metadata?.designFeedback
    const described = isNotice(notice)
      ? { text: DesignFeed.reviewText(notice), notes: notice.notes.length }
      : DesignFeed.describe(item.text)
    return [{ ...base, type: "user", id: item.messageID, ...described, ...(pending ? { pending: true } : {}) }]
  }
  if (item.type === "text" && role === "assistant" && item.time?.end !== undefined) {
    const text = DesignFeed.bound(item.text, DesignFeed.LIMITS.text)
    return text ? [{ ...base, type: "reply", id: item.id, text }] : []
  }
  if (item.type !== "tool") return []
  const status = item.state.status === "completed" ? "done" : item.state.status === "error" ? "failed" : "running"
  const summary =
    item.state.status === "error"
      ? item.state.error
      : item.state.status === "completed"
        ? item.state.title
        : (item.state.status === "running" && item.state.title) || DesignFeed.summarize(item.state.input)
  const entry: Design.FeedEvent = {
    ...base,
    type: "tool",
    id: item.callID,
    tool: item.tool,
    status,
    summary: DesignFeed.bound(summary, DesignFeed.LIMITS.summary),
  }
  if (item.tool !== DesignFeed.PREVIEW_TOOL || item.state.status !== "completed") return [entry]
  const revision = item.state.metadata.revision
  const design = item.state.metadata.id
  if (typeof revision !== "string" || !revision || !Schema.is(Design.ID)(design)) return [entry]
  const name = item.state.input.name
  return [entry, { ...base, type: "published", design, revision, name: typeof name === "string" ? name : "" }]
}

/**
 * Entries for the stored transcript, oldest first, with the state the live reducer continues from.
 * `pending` holds the ids of admitted prompts no turn has taken up yet (their inbox rows are unpromoted).
 */
export function replay(
  messages: ReadonlyArray<typeof SessionV1.WithParts.Type>,
  pending: ReadonlySet<string> = new Set(),
): {
  state: State
  events: Design.FeedEvent[]
} {
  const roles = new Map(messages.map((message) => [message.info.id, message.info.role] as const))
  const events = messages.flatMap((message) =>
    message.parts.flatMap((item) =>
      part(message.info.role, item, message.info.time.created, pending.has(message.info.id)),
    ),
  )
  return {
    state: {
      roles,
      promoted: new Set(messages.flatMap((message) => (pending.has(message.info.id) ? [] : [message.info.id]))),
      users: new Map(events.flatMap((entry) => (entry.type === "user" ? [[MessageID.make(entry.id), entry]] : []))),
    },
    events,
  }
}

/** Reduce one live bus event. Legacy entries carry no durable cursor, so `seq` stays 0. */
export function reduce(state: State, event: EventV2.Payload): readonly [state: State, events: Design.FeedEvent[]] {
  const at = Date.now()
  if (event.type === SessionV1.Event.MessageUpdated.type && isMessage(event.data))
    return [{ ...state, roles: new Map(state.roles).set(event.data.info.id, event.data.info.role) }, []]
  if (event.type === SessionV1.Event.PartUpdated.type && isPart(event.data)) {
    const id = event.data.part.messageID
    const role = state.roles.get(id)
    // A user message's parts are written at admission; until its promotion no turn has read them.
    const entries = part(role, event.data.part, at, role === "user" && !state.promoted.has(id))
    const user = entries.find((entry) => entry.type === "user")
    return [user ? { ...state, users: new Map(state.users).set(id, user) } : state, entries]
  }
  // Prompt Promotion: a turn has taken the admitted prompt up, so its entry is repeated as delivered.
  if (event.type === SessionV1.Event.MessagePromoted.type && isPromoted(event.data)) {
    const id = event.data.messageID
    const next = { ...state, promoted: new Set(state.promoted).add(id) }
    const entry = state.users.get(id)
    if (entry?.type !== "user") return [next, []]
    const { pending: _pending, ...delivered } = entry
    return [next, [{ ...delivered, at }]]
  }
  if (event.type === SessionStatusEvent.Status.type && isStatus(event.data))
    return [state, [{ type: "state", seq: 0, at, state: event.data.status.type === "idle" ? "idle" : "working" }]]
  if (event.type === SessionV1.Event.Updated.type && isSession(event.data) && event.data.info.agent)
    return [state, [{ type: "agent", seq: 0, at, agent: event.data.info.agent }]]
  return [state, []]
}

export interface Interface {
  /**
   * The replayed transcript followed by live entries for one session of this instance. There is
   * no cursor: the V1 bus is not durable, so every connection replays the whole transcript and
   * the client merges repeats by id.
   */
  readonly stream: (sessionID: SessionID) => Effect.Effect<Stream.Stream<Design.FeedEvent>>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/DesignFeedV1") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service
    const database = yield* Database.Service
    const stream = Effect.fn("DesignFeed.stream")(function* (sessionID: SessionID) {
      const instance = yield* InstanceState.context
      // A client that cannot keep up loses the oldest live entries; its next connection replays anyway.
      const queue = yield* Queue.sliding<EventV2.Payload>(256)
      // Listen before reading the transcript so nothing published in between is lost.
      const off = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.location?.directory !== instance.directory) return
          const data = event.data
          if (typeof data !== "object" || data === null || !("sessionID" in data) || data.sessionID !== sessionID)
            return
          Queue.offerUnsafe(queue, event)
        }),
      )
      const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
      const current = yield* status.get(sessionID)
      const messages = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
      // Read after the transcript: a prompt promoted in between is simply reported delivered, and its
      // live promotion event repeats the same entry.
      const pending = yield* SessionInput.listPending(database.db, SessionSchema.ID.make(sessionID))
      const replayed = replay(messages, new Set(pending.map((row) => row.id)))
      const at = Date.now()
      const head: Design.FeedEvent[] = [
        { type: "agent", seq: 0, at, agent: session.agent ?? "" },
        { type: "state", seq: 0, at, state: current.type === "idle" ? "idle" : "working" },
        ...replayed.events,
      ]
      const live = Stream.fromQueue(queue).pipe(Stream.mapAccum(() => replayed.state, reduce))
      return Stream.fromIterable(head).pipe(Stream.concat(live), Stream.ensuring(off))
    })
    return Service.of({ stream })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [EventV2Bridge.node, Session.node, SessionStatus.node, Database.node],
})
