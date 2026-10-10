import { expect } from "bun:test"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { it } from "../../core/test/lib/effect"
import { ServerPairing } from "../src/pairing"

it.effect("pairing codes expire after five minutes and can be consumed only once", () =>
  Effect.gen(function* () {
    const pairing = yield* ServerPairing.Service
    const once = yield* pairing.issue()
    expect(yield* pairing.consume(once.code)).toBe(true)
    expect(yield* pairing.consume(once.code)).toBe(false)
    const expiring = yield* pairing.issue()
    expect(expiring.expires_in).toBe(300)
    yield* TestClock.adjust("5 minutes")
    expect(yield* pairing.consume(expiring.code)).toBe(false)
  }).pipe(Effect.provide(LayerNode.compile(ServerPairing.node))),
)
