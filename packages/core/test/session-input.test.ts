import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@reddb-io/redcode-core/database/database"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import { Project } from "@reddb-io/redcode-core/project"
import { ProjectTable } from "@reddb-io/redcode-core/project/sql"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { SessionV2 } from "@reddb-io/redcode-core/session"
import { SessionEvent } from "@reddb-io/redcode-core/session/event"
import { SessionInput } from "@reddb-io/redcode-core/session/input"
import { SessionMessage } from "@reddb-io/redcode-core/session/message"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { Prompt } from "@reddb-io/redcode-core/session/prompt"
import { SessionTable } from "@reddb-io/redcode-core/session/sql"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node]), []))
const sessionID = SessionV2.ID.make("ses_input_test")

const setupSession = (id: SessionV2.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id,
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "test",
      directory: "/project",
      title: "test",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const admit = (id: SessionMessage.ID, text: string, delivery: SessionInput.Delivery) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    return yield* SessionInput.admit(db, events, { id, sessionID, prompt: Prompt.fromUserMessage({ text }), delivery })
  })

const userInfo = (id: SessionMessage.ID, session: SessionV2.ID, created = Date.now()): SessionV1.User => ({
  id: SessionV1.MessageID.make(id),
  role: "user",
  sessionID: session,
  time: { created },
  agent: "build",
  model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
})

// The canonical V1 user message next to an inbox row, published the way `Session.updateMessage` does.
const publishUser = (id: SessionMessage.ID) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    return yield* events.publish(SessionV1.Event.MessageUpdated, { sessionID, info: userInfo(id, sessionID) })
  })

// What the V1 loop publishes right after the re-publication: the durable fact of the promotion.
const publishPromoted = (id: SessionMessage.ID) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    return yield* events.publish(SessionV1.Event.MessagePromoted, {
      sessionID,
      messageID: SessionV1.MessageID.make(id),
    })
  })

const versioned = (definition: { type: string; durable?: { version: number } }) =>
  EventV2.versionedType(definition.type, definition.durable?.version ?? 1)

// The serialized aggregate a replica receives through sync/steal replay.
const replayEvents = (session: SessionV2.ID, id: SessionMessage.ID, opts: { promoted: boolean }) => {
  const created = Date.now()
  const events = [
    {
      type: versioned(SessionEvent.PromptAdmitted),
      data: {
        messageID: id,
        sessionID: session,
        timestamp: created,
        prompt: { text: "replayed" },
        delivery: "steer",
      },
    },
    {
      type: versioned(SessionV1.Event.MessageUpdated),
      data: { sessionID: session, info: userInfo(id, session, created) },
    },
    {
      type: versioned(SessionV1.Event.MessageUpdated),
      data: { sessionID: session, info: userInfo(id, session, created + 5) },
    },
    ...(opts.promoted
      ? [{ type: versioned(SessionV1.Event.MessagePromoted), data: { sessionID: session, messageID: id } }]
      : []),
  ]
  return events.map((event, seq) => ({ id: EventV2.ID.create(), seq, aggregateID: session, ...event }))
}

const pending = (filter?: { readonly delivery?: SessionInput.Delivery; readonly cutoffSeq?: number }) =>
  Database.Service.use(({ db }) => SessionInput.listPending(db, sessionID, filter))

describe("SessionInput legacy promotion", () => {
  it.effect("promotes a pending row only through the durable message.promoted event", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const id = SessionMessage.ID.create()
      const admitted = yield* admit(id, "hello", "steer")

      const created = yield* publishUser(id)
      expect((yield* SessionInput.find(db, id))?.promotedSeq).toBeUndefined()
      expect((yield* pending()).map((row) => row.id)).toEqual([id])

      // A retried publication of the same message (an idempotent prompt retry) is not a promotion.
      yield* publishUser(id)
      expect((yield* SessionInput.find(db, id))?.promotedSeq).toBeUndefined()
      expect((yield* pending()).map((row) => row.id)).toEqual([id])

      const promoted = yield* publishPromoted(id)
      const stored = yield* SessionInput.find(db, id)
      expect(stored?.promotedSeq).toBe(promoted.durable?.seq)
      expect(stored?.admittedSeq).toBe(admitted.admittedSeq)
      expect(created.durable?.seq).toBeLessThan(promoted.durable?.seq ?? -1)
      expect(yield* pending()).toEqual([])
      // Idempotent: a second promotion event leaves the stamp alone.
      yield* publishPromoted(id)
      expect((yield* SessionInput.find(db, id))?.promotedSeq).toBe(promoted.durable?.seq)
    }),
  )

  it.effect("replaying a promoted aggregate stamps the row on the replica", () =>
    Effect.gen(function* () {
      const replica = SessionV2.ID.make("ses_input_replay_promoted")
      yield* setupSession(replica)
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const id = SessionMessage.ID.create()
      yield* events.replayAll(replayEvents(replica, id, { promoted: true }))
      const stored = yield* SessionInput.find(db, id)
      expect(stored?.admittedSeq).toBe(0)
      expect(stored?.promotedSeq).toBe(3)
      expect(yield* SessionInput.listPending(db, replica)).toEqual([])
    }),
  )

  it.effect("replaying an aggregate without message.promoted leaves the row pending", () =>
    Effect.gen(function* () {
      const replica = SessionV2.ID.make("ses_input_replay_pending")
      yield* setupSession(replica)
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const id = SessionMessage.ID.create()
      yield* events.replayAll(replayEvents(replica, id, { promoted: false }))
      const stored = yield* SessionInput.find(db, id)
      expect(stored?.admittedSeq).toBe(0)
      expect(stored?.promotedSeq).toBeUndefined()
      expect((yield* SessionInput.listPending(db, replica)).map((row) => row.id)).toEqual([id])
    }),
  )

  it.effect("drops a pending row when its V1 message is removed", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const id = SessionMessage.ID.create()
      yield* admit(id, "hello", "queue")
      yield* publishUser(id)
      yield* events.publish(SessionV1.Event.MessageRemoved, { sessionID, messageID: SessionV1.MessageID.make(id) })
      expect(yield* SessionInput.find(db, id)).toBeUndefined()
    }),
  )

  it.effect("projectLegacyPromotion only promotes a pending row once", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const id = SessionMessage.ID.create()
      yield* admit(id, "hello", "queue")
      expect(yield* SessionInput.projectLegacyPromotion(db, { id, sessionID, promotedSeq: 40 })).toBe(true)
      expect(yield* SessionInput.projectLegacyPromotion(db, { id, sessionID, promotedSeq: 41 })).toBe(false)
      expect((yield* SessionInput.find(db, id))?.promotedSeq).toBe(40)
      expect(
        yield* SessionInput.projectLegacyPromotion(db, { id: SessionMessage.ID.create(), sessionID, promotedSeq: 42 }),
      ).toBe(false)
    }),
  )

  it.effect("listPending orders by admission and filters by delivery and cutoff", () =>
    Effect.gen(function* () {
      yield* setup
      const first = SessionMessage.ID.create()
      const second = SessionMessage.ID.create()
      const third = SessionMessage.ID.create()
      const a = yield* admit(first, "one", "steer")
      yield* admit(second, "two", "queue")
      const c = yield* admit(third, "three", "steer")

      expect((yield* pending()).map((row) => row.id)).toEqual([first, second, third])
      expect((yield* pending({ delivery: "steer" })).map((row) => row.id)).toEqual([first, third])
      expect((yield* pending({ delivery: "queue" })).map((row) => row.id)).toEqual([second])
      expect((yield* pending({ delivery: "steer", cutoffSeq: a.admittedSeq })).map((row) => row.id)).toEqual([first])
      expect((yield* pending({ cutoffSeq: c.admittedSeq - 1 })).map((row) => row.id)).toEqual([first, second])

      yield* publishUser(first)
      yield* publishPromoted(first)
      expect((yield* pending({ delivery: "steer" })).map((row) => row.id)).toEqual([third])
    }),
  )
})
