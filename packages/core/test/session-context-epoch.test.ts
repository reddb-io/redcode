import { describe, expect } from "bun:test"
import { and, eq } from "drizzle-orm"
import { Effect, Layer, Ref, Schema } from "effect"
import { Database } from "@reddb-io/redcode-core/database/database"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { Location } from "@reddb-io/redcode-core/location"
import { ProjectV2 } from "@reddb-io/redcode-core/project"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { SessionV2 } from "@reddb-io/redcode-core/session"
import { SessionContextEpoch } from "@reddb-io/redcode-core/session/context-epoch"
import { SessionExecution } from "@reddb-io/redcode-core/session/execution"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { SessionContextEpochTable, SessionMessageTable } from "@reddb-io/redcode-core/session/sql"
import { SessionStore } from "@reddb-io/redcode-core/session/store"
import { SystemContext } from "@reddb-io/redcode-core/system-context"
import { testEffect } from "./lib/effect"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

const Boundary = EventV2.define({
  type: "test.session.context-epoch.boundary",
  durable: { aggregate: "sessionID", version: 1 },
  schema: { sessionID: SessionV2.ID, value: Schema.String },
})

const stable = SystemContext.make({
  key: SystemContext.Key.make("test/stable"),
  codec: Schema.toCodecJson(Schema.String),
  load: Effect.succeed("stable text"),
  baseline: (text) => text,
  update: (_previous, text) => `stable now: ${text}`,
})
const stableOnly = Effect.succeed(stable)

/** The stable source plus one whose observation is driven by the test. */
const context = (flaky: Ref.Ref<string | SystemContext.Unavailable>) =>
  Effect.succeed(
    SystemContext.combine([
      stable,
      SystemContext.make({
        key: SystemContext.Key.make("test/flaky"),
        codec: Schema.toCodecJson(Schema.String),
        load: Ref.get(flaky),
        baseline: (text) => text,
        update: (_previous, text) => `flaky now: ${text}`,
        removed: () => "flaky gone",
      }),
    ]),
  )

const epoch = (sessionID: SessionV2.ID) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    return yield* db
      .select()
      .from(SessionContextEpochTable)
      .where(eq(SessionContextEpochTable.session_id, sessionID))
      .get()
  })

const systemRows = (sessionID: SessionV2.ID) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    return yield* db
      .select()
      .from(SessionMessageTable)
      .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "system")))
      .all()
  })

describe("SessionContextEpoch.requestReplacement", () => {
  it.effect("a requested replacement waits for an unavailable source and then renders a fresh baseline", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const events = yield* EventV2.Service
      const session = yield* SessionV2.Service
      const flaky = yield* Ref.make<string | SystemContext.Unavailable>("flaky one")
      const created = yield* session.create({ location })
      const first = yield* SessionContextEpoch.prepare(db, events, context(flaky), created.id)
      expect(first.baseline).toBe("stable text\n\nflaky one")

      // The boundary: events after the baseline, as a compaction summary would be.
      yield* events.publish(Boundary, { sessionID: created.id, value: "summary" })
      yield* SessionContextEpoch.requestReplacement(db, created.id)
      const requested = yield* epoch(created.id)
      expect(requested?.replacement_seq).toBe(yield* EventV2.latestSequence(db, created.id))
      expect(requested?.replacement_seq).toBeGreaterThan(first.baselineSeq)

      // Blocked: the stored generation stays in force, nothing is admitted, the request is kept.
      yield* Ref.set(flaky, SystemContext.unavailable)
      const blocked = yield* SessionContextEpoch.prepare(db, events, context(flaky), created.id)
      expect(blocked).toEqual({ baseline: first.baseline, baselineSeq: first.baselineSeq })
      expect(yield* epoch(created.id)).toEqual(requested)
      expect(yield* systemRows(created.id)).toHaveLength(0)

      // Still blocked on a later boundary, still pending.
      yield* events.publish(Boundary, { sessionID: created.id, value: "later" })
      expect(yield* SessionContextEpoch.prepare(db, events, context(flaky), created.id)).toEqual(blocked)
      expect((yield* epoch(created.id))?.replacement_seq).toBe(requested?.replacement_seq)

      // Observable again: one fresh generation, fenced at the requested boundary, no update admitted.
      yield* Ref.set(flaky, "flaky two")
      const replaced = yield* SessionContextEpoch.prepare(db, events, context(flaky), created.id)
      expect(replaced.baseline).toBe("stable text\n\nflaky two")
      expect(replaced.baselineSeq).toBe(requested!.replacement_seq!)
      const row = yield* epoch(created.id)
      expect(row?.baseline).toBe(replaced.baseline)
      expect(row?.baseline_seq).toBe(replaced.baselineSeq)
      expect(row?.replacement_seq).toBeNull()
      expect(row?.snapshot).toEqual({
        "test/stable": { value: "stable text" },
        "test/flaky": { value: "flaky two", removed: "flaky gone" },
      })
      expect(yield* systemRows(created.id)).toHaveLength(0)

      // The next preparation is an ordinary reconciliation again.
      yield* Ref.set(flaky, "flaky three")
      const reconciled = yield* SessionContextEpoch.prepare(db, events, context(flaky), created.id)
      expect(reconciled).toEqual({ baseline: replaced.baseline, baselineSeq: replaced.baselineSeq })
      expect((yield* systemRows(created.id)).map((row) => row.data)).toEqual([
        expect.objectContaining({ text: "flaky now: flaky three" }),
      ])
    }),
  )

  it.effect("a source that was never admitted does not block the replacement", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const events = yield* EventV2.Service
      const session = yield* SessionV2.Service
      const flaky = yield* Ref.make<string | SystemContext.Unavailable>(SystemContext.unavailable)
      const created = yield* session.create({ location })
      // Initialization is blocked by the unavailable source, so the epoch starts without it.
      const blocked = yield* SessionContextEpoch.prepare(db, events, context(flaky), created.id).pipe(Effect.flip)
      expect(blocked).toBeInstanceOf(SystemContext.InitializationBlocked)
      const first = yield* SessionContextEpoch.prepare(db, events, stableOnly, created.id)
      expect(first.baseline).toBe("stable text")

      yield* events.publish(Boundary, { sessionID: created.id, value: "summary" })
      yield* SessionContextEpoch.requestReplacement(db, created.id)
      const replaced = yield* SessionContextEpoch.prepare(db, events, context(flaky), created.id)

      expect(replaced.baseline).toBe("stable text")
      expect(replaced.baselineSeq).toBeGreaterThan(first.baselineSeq)
      expect((yield* epoch(created.id))?.replacement_seq).toBeNull()
    }),
  )

  it.effect("a request with no durable event since the baseline still replaces at the next preparation", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const events = yield* EventV2.Service
      const session = yield* SessionV2.Service
      const flaky = yield* Ref.make<string | SystemContext.Unavailable>("flaky one")
      const created = yield* session.create({ location })
      const first = yield* SessionContextEpoch.prepare(db, events, context(flaky), created.id)
      yield* SessionContextEpoch.requestReplacement(db, created.id)
      expect((yield* epoch(created.id))?.replacement_seq).toBe(first.baselineSeq)

      // A changed source is rendered into a whole new baseline, not admitted as an update.
      yield* Ref.set(flaky, "flaky two")
      const replaced = yield* SessionContextEpoch.prepare(db, events, context(flaky), created.id)

      expect(replaced).toEqual({ baseline: "stable text\n\nflaky two", baselineSeq: first.baselineSeq })
      expect(yield* systemRows(created.id)).toHaveLength(0)
      const row = yield* epoch(created.id)
      expect(row?.baseline).toBe(replaced.baseline)
      expect(row?.replacement_seq).toBeNull()
    }),
  )

  it.effect("a request that lands while the replacement is rendered is kept for the next preparation", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const events = yield* EventV2.Service
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      const armed = yield* Ref.make(true)
      // Observed between the row being read and the generation being written: a later compaction
      // boundary requests a replacement of its own.
      const racing = Effect.succeed(
        SystemContext.combine([
          stable,
          SystemContext.make({
            key: SystemContext.Key.make("test/racer"),
            codec: Schema.toCodecJson(Schema.String),
            load: Effect.gen(function* () {
              if (!(yield* Ref.getAndSet(armed, false))) return "racer"
              yield* events.publish(Boundary, { sessionID: created.id, value: "later compaction" })
              yield* SessionContextEpoch.requestReplacement(db, created.id)
              return "racer"
            }),
            baseline: (text) => text,
            update: (_previous, text) => `racer now: ${text}`,
          }),
        ]),
      )
      const first = yield* SessionContextEpoch.prepare(db, events, stableOnly, created.id)
      yield* events.publish(Boundary, { sessionID: created.id, value: "summary" })
      yield* SessionContextEpoch.requestReplacement(db, created.id)
      const requested = (yield* epoch(created.id))!.replacement_seq!

      const replaced = yield* SessionContextEpoch.prepare(db, events, racing, created.id)

      expect(replaced).toEqual({ baseline: "stable text\n\nracer", baselineSeq: requested })
      const row = yield* epoch(created.id)
      expect(row?.baseline_seq).toBe(requested)
      expect(row?.replacement_seq).toBe(yield* EventV2.latestSequence(db, created.id))
      expect(row?.replacement_seq).toBeGreaterThan(requested)
      expect(first.baselineSeq).toBeLessThan(requested)

      const again = yield* SessionContextEpoch.prepare(db, events, racing, created.id)
      expect(again.baselineSeq).toBe(row!.replacement_seq!)
      expect((yield* epoch(created.id))?.replacement_seq).toBeNull()
      expect(yield* systemRows(created.id)).toHaveLength(0)
    }),
  )

  it.effect("a request without an active epoch is a no-op and the next preparation initializes", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const events = yield* EventV2.Service
      const session = yield* SessionV2.Service
      const flaky = yield* Ref.make<string | SystemContext.Unavailable>("flaky one")
      const created = yield* session.create({ location })

      yield* SessionContextEpoch.requestReplacement(db, created.id)
      expect(yield* epoch(created.id)).toBeUndefined()
      const first = yield* SessionContextEpoch.prepare(db, events, context(flaky), created.id)

      expect(first.baseline).toBe("stable text\n\nflaky one")
      expect((yield* epoch(created.id))?.replacement_seq).toBeNull()
    }),
  )
})
