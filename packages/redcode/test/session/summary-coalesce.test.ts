import { expect } from "bun:test"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { Deferred, Effect, Exit, Layer, Ref } from "effect"
import { Session as SessionNs } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "@/session/summary"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { ModelV2 } from "@reddb-io/redcode-core/model"

// summarize() is forked at every step-finish. Each run hydrates the whole session and
// diffs the whole turn, so overlapping runs used to hold several full copies at once.
// A counting stub for the one expensive call lets the test observe the coalescing.
const calls = Ref.makeUnsafe(0)
const gate = Deferred.makeUnsafe<void>()

const snapshotStub = Layer.succeed(
  Snapshot.Service,
  Snapshot.Service.of({
    init: () => Effect.void,
    cleanup: () => Effect.void,
    track: () => Effect.succeed(undefined),
    patch: () => Effect.succeed({ hash: "", files: [] } as never),
    restore: () => Effect.void,
    revert: () => Effect.void,
    diff: () => Effect.succeed(""),
    diffFull: () =>
      Ref.update(calls, (n) => n + 1).pipe(
        // Hold the first run open so the later requests pile up behind it.
        Effect.andThen(Deferred.await(gate)),
        Effect.as([]),
      ),
  }),
)

const it = testEffect(
  Layer.provideMerge(
    LayerNode.compile(LayerNode.group([SessionSummary.node, SessionNs.node, MessageV2.node, SessionProjector.node]), [
      [Snapshot.node, snapshotStub],
    ]),
    Layer.empty,
  ),
)

const turn = Effect.fn("Test.turn")(function* (sessionID: SessionID) {
  const session = yield* SessionNs.Service
  const userID = MessageID.ascending()
  yield* session.updateMessage({
    id: userID,
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "test",
    model: { providerID: "test", modelID: "test" },
    tools: {},
    mode: "",
  } as unknown as SessionV1.Info)
  const assistantID = MessageID.ascending()
  yield* session.updateMessage({
    id: assistantID,
    sessionID,
    role: "assistant",
    time: { created: Date.now() },
    parentID: userID,
    modelID: ModelV2.ID.make("test"),
    providerID: ProviderV2.ID.make("test"),
    mode: "",
    agent: "default",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as SessionV1.Info)
  yield* session.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: assistantID,
    type: "step-start",
    snapshot: "aaaa",
  } as never)
  yield* session.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: assistantID,
    type: "step-finish",
    snapshot: "bbbb",
    reason: "stop",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as never)
  return userID
})

it.instance("summarize collapses concurrent requests instead of running one full pass each", () =>
  Effect.gen(function* () {
    const session = yield* SessionNs.Service
    const summary = yield* SessionSummary.Service
    const created = yield* session.create({})
    const messageID = yield* turn(created.id)

    // Five requests land while the first run is still held open by the gate.
    yield* Effect.exit(
      Effect.forEach([1, 2, 3, 4, 5], () => summary.summarize({ sessionID: created.id, messageID }), {
        concurrency: "unbounded",
      }).pipe(Effect.timeout("500 millis")),
    )
    // Without coalescing each request would hydrate the session and diff the turn on its own.
    expect(yield* Ref.get(calls)).toBe(1)

    yield* Deferred.done(gate, Exit.void)
    // The work itself still happens once the way is clear.
    yield* summary.summarize({ sessionID: created.id, messageID })
    expect(yield* Ref.get(calls)).toBe(2)
    yield* session.remove(created.id).pipe(Effect.ignore)
  }),
)
