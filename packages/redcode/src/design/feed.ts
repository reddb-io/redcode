export * as DesignFeed from "./feed"

import { Context, Effect, Layer, Queue, Schema, Stream } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { SessionStatusEvent } from "@reddb-io/redcode-schema/session-status-event"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { DesignFeed } from "@reddb-io/redcode-core/design/feed"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { MessageID, SessionID } from "@/session/schema"

/** Message roles seen so far: a V1 part update does not say whose message it belongs to. */
export interface State {
  readonly roles: ReadonlyMap<MessageID, "user" | "assistant">
}

export const initial: State = { roles: new Map() }

const isPart = Schema.is(Schema.toType(SessionV1.Event.PartUpdated.data))
const isMessage = Schema.is(Schema.toType(SessionV1.Event.MessageUpdated.data))
const isSession = Schema.is(Schema.toType(SessionV1.Event.Updated.data))
const isStatus = Schema.is(Schema.toType(SessionStatusEvent.Status.data))
const isNotice = Schema.is(Design.FeedbackNotice)

/** Feed entries for one V1 part. Replay and live updates share this so both describe a part alike. */
export function part(
  role: "user" | "assistant" | undefined,
  item: typeof SessionV1.Part.Type,
  at: number,
): Design.FeedEvent[] {
  const base = { seq: 0, at }
  if (item.type === "text" && role === "user" && !item.synthetic && !item.ignored) {
    const notice = item.metadata?.designFeedback
    return [
      {
        ...base,
        type: "user",
        id: item.messageID,
        text: isNotice(notice) ? DesignFeed.describeNotice(notice) : DesignFeed.describe(item.text),
      },
    ]
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

/** Entries for the stored transcript, oldest first, with the roles the live reducer continues from. */
export function replay(messages: ReadonlyArray<typeof SessionV1.WithParts.Type>): {
  state: State
  events: Design.FeedEvent[]
} {
  const roles = new Map(messages.map((message) => [message.info.id, message.info.role] as const))
  return {
    state: { roles },
    events: messages.flatMap((message) =>
      message.parts.flatMap((item) => part(message.info.role, item, message.info.time.created)),
    ),
  }
}

/** Reduce one live bus event. `seq` is left at 0; the stream stamps its per-session sequence. */
export function reduce(state: State, event: EventV2.Payload): readonly [state: State, events: Design.FeedEvent[]] {
  const at = Date.now()
  if (event.type === SessionV1.Event.MessageUpdated.type && isMessage(event.data))
    return [{ roles: new Map(state.roles).set(event.data.info.id, event.data.info.role) }, []]
  if (event.type === SessionV1.Event.PartUpdated.type && isPart(event.data))
    return [state, part(state.roles.get(event.data.part.messageID), event.data.part, at)]
  if (event.type === SessionStatusEvent.Status.type && isStatus(event.data))
    return [state, [{ type: "state", seq: 0, at, state: event.data.status.type === "idle" ? "idle" : "working" }]]
  if (event.type === SessionV1.Event.Updated.type && isSession(event.data) && event.data.info.agent)
    return [state, [{ type: "agent", seq: 0, at, agent: event.data.info.agent }]]
  return [state, []]
}

export interface Interface {
  /** Replayed transcript entries (seq 0) followed by live entries for one session of this instance. */
  readonly stream: (sessionID: SessionID, after: number) => Effect.Effect<Stream.Stream<Design.FeedEvent>>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/DesignFeedV1") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service
    // Live entries carry a per-session sequence so a client can tell a reconnect's replay from news.
    const counters = yield* InstanceState.make(() => Effect.succeed(new Map<SessionID, number>()))
    const stream = Effect.fn("DesignFeed.stream")(function* (sessionID: SessionID, after: number) {
      const instance = yield* InstanceState.context
      const sequence = yield* InstanceState.get(counters)
      const queue = yield* Queue.unbounded<EventV2.Payload>()
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
      const replayed = replay(yield* sessions.messages({ sessionID }).pipe(Effect.orDie))
      const at = Date.now()
      const head: Design.FeedEvent[] = [
        { type: "agent", seq: 0, at, agent: session.agent ?? "" },
        { type: "state", seq: 0, at, state: current.type === "idle" ? "idle" : "working" },
        ...replayed.events,
      ]
      const live = Stream.fromQueue(queue).pipe(
        Stream.mapAccum(
          () => replayed.state,
          (state, event) => {
            const [next, items] = reduce(state, event)
            return [
              next,
              items.map((item) => {
                const seq = (sequence.get(sessionID) ?? 0) + 1
                sequence.set(sessionID, seq)
                return { ...item, seq }
              }),
            ]
          },
        ),
        Stream.filter((event) => event.seq > after),
      )
      return Stream.fromIterable(head).pipe(Stream.concat(live), Stream.ensuring(off))
    })
    return Service.of({ stream })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [EventV2Bridge.node, Session.node, SessionStatus.node],
})
