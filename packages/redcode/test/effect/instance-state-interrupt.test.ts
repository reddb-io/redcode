import { expect } from "bun:test"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(LayerNode.compile(CrossSpawnSpawner.node), testInstanceStoreLayer))

// A cancelled HTTP request interrupts the fiber that happens to run the cached lookup. That
// interruption must not become the cached value: before the fix every later request for the
// instance replayed it as HTTP 499 until the instance was disposed.
const gatedState = Effect.gen(function* () {
  const started = yield* Deferred.make<void>()
  const gate = yield* Deferred.make<void>()
  const counter = { runs: 0 }
  const state = yield* InstanceState.make(() =>
    Effect.gen(function* () {
      const run = ++counter.runs
      yield* Deferred.succeed(started, undefined)
      yield* Deferred.await(gate)
      return { run }
    }),
  )
  return { state, started, gate, counter }
})

it.live("InstanceState does not cache a lookup interrupted by its first caller", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const { state, started, gate, counter } = yield* gatedState
    const first = yield* InstanceState.get(state).pipe(provideInstanceEffect(dir), Effect.forkChild)
    yield* Deferred.await(started)
    yield* Fiber.interrupt(first)
    yield* Deferred.succeed(gate, undefined)

    const next = yield* InstanceState.get(state).pipe(provideInstanceEffect(dir), Effect.timeout("5 seconds"))
    const again = yield* InstanceState.get(state).pipe(provideInstanceEffect(dir))

    expect(next).toBe(again)
    expect(counter.runs).toBe(2)
  }),
)

it.live("InstanceState serves callers that were waiting on an interrupted lookup", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const { state, started, gate } = yield* gatedState
    const first = yield* InstanceState.get(state).pipe(provideInstanceEffect(dir), Effect.forkChild)
    yield* Deferred.await(started)
    const waiter = yield* InstanceState.get(state).pipe(provideInstanceEffect(dir), Effect.forkChild)
    yield* Fiber.interrupt(first)
    yield* Deferred.succeed(gate, undefined)

    const exit = yield* Fiber.await(waiter).pipe(Effect.timeout("5 seconds"))
    expect(Exit.isSuccess(exit)).toBe(true)
  }),
)
