import { describe, expect } from "bun:test"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Location } from "@reddb-io/redcode-core/location"
import { OperationHook } from "@reddb-io/redcode-core/operation-hook"
import { DateTime, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location(Location.Ref.make({ directory: AbsolutePath.make("project") }))),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Location.node, OperationHook.node]), [[Location.node, locationLayer]]),
)

const text = (value: string, timestamp: DateTime.Utc) => ({
  timestamp,
  sessionID: "session",
  messageID: "message",
  partID: "part",
  text: value,
})

describe("OperationHook", () => {
  it.effect("returns waterfall input when no handlers are registered", () =>
    Effect.gen(function* () {
      const hooks = yield* OperationHook.Service
      const input = text("original", yield* DateTime.now)

      expect(yield* hooks.waterfall(OperationHook.Operation.Text.Complete, input)).toEqual(input)
    }),
  )

  it.effect("runs waterfall handlers in registration order with one operation identity", () =>
    Effect.gen(function* () {
      const hooks = yield* OperationHook.Service
      const order: string[] = []
      const ids: string[] = []
      const locations: string[] = []

      yield* hooks.register.waterfall(OperationHook.Operation.Text.Complete, (event, next) =>
        Effect.gen(function* () {
          order.push("first:before")
          ids.push(event.id)
          locations.push(event.location.directory)
          const downstream = yield* next({ ...event.data, text: `${event.data.text}:first` })
          order.push("first:after")
          return { ...downstream, text: `${downstream.text}:after` }
        }),
      )
      yield* hooks.register.waterfall(OperationHook.Operation.Text.Complete, (event) => {
        order.push("second")
        ids.push(event.id)
        locations.push(event.location.directory)
        return { ...event.data, text: `${event.data.text}:second` }
      })

      const result = yield* hooks.waterfall(
        OperationHook.Operation.Text.Complete,
        text("original", yield* DateTime.now),
      )

      expect(result.text).toBe("original:first:second:after")
      expect(order).toEqual(["first:before", "second", "first:after"])
      expect(new Set(ids).size).toBe(1)
      expect(locations).toEqual(["project", "project"])
    }),
  )

  it.effect("short-circuits waterfall handlers when next is skipped", () =>
    Effect.gen(function* () {
      const hooks = yield* OperationHook.Service
      let downstream = false
      yield* hooks.register.waterfall(OperationHook.Operation.Text.Complete, (event) => ({
        ...event.data,
        text: "blocked",
      }))
      yield* hooks.register.waterfall(OperationHook.Operation.Text.Complete, (event) => {
        downstream = true
        return event.data
      })

      const result = yield* hooks.waterfall(
        OperationHook.Operation.Text.Complete,
        text("original", yield* DateTime.now),
      )

      expect(result.text).toBe("blocked")
      expect(downstream).toBe(false)
    }),
  )

  it.effect("removes registrations when their scope closes", () =>
    Effect.gen(function* () {
      const hooks = yield* OperationHook.Service
      const scope = yield* Scope.make()
      yield* hooks.register
        .waterfall(OperationHook.Operation.Text.Complete, (event) => ({ ...event.data, text: "registered" }))
        .pipe(Scope.provide(scope))

      expect(
        (yield* hooks.waterfall(OperationHook.Operation.Text.Complete, text("before", yield* DateTime.now))).text,
      ).toBe("registered")
      yield* Scope.close(scope, Exit.void)
      expect(
        (yield* hooks.waterfall(OperationHook.Operation.Text.Complete, text("after", yield* DateTime.now))).text,
      ).toBe("after")
    }),
  )

  it.effect("runs serial observers one at a time", () =>
    Effect.gen(function* () {
      const hooks = yield* OperationHook.Service
      const definition = new OperationHook.Definition<"test.serial", { value: string }, "serial">(
        "test.serial",
        "serial",
      )
      const firstStarted = yield* Deferred.make<void>()
      const releaseFirst = yield* Deferred.make<void>()
      const secondStarted = yield* Deferred.make<void>()
      yield* hooks.register.serial(definition, () =>
        Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst))),
      )
      yield* hooks.register.serial(definition, () => Deferred.succeed(secondStarted, undefined))
      const dispatch = yield* hooks.serial(definition, { value: "test" }).pipe(Effect.forkChild)

      yield* Deferred.await(firstStarted)
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(secondStarted)).toBe(false)
      yield* Deferred.succeed(releaseFirst, undefined)
      yield* Fiber.join(dispatch)
      expect(yield* Deferred.isDone(secondStarted)).toBe(true)
    }),
  )

  it.effect("runs parallel observers concurrently", () =>
    Effect.gen(function* () {
      const hooks = yield* OperationHook.Service
      const firstStarted = yield* Deferred.make<void>()
      const releaseFirst = yield* Deferred.make<void>()
      const secondStarted = yield* Deferred.make<void>()
      yield* hooks.register.parallel(OperationHook.Operation.Turn.Started, () =>
        Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst))),
      )
      yield* hooks.register.parallel(OperationHook.Operation.Turn.Started, () =>
        Deferred.succeed(secondStarted, undefined),
      )
      const dispatch = yield* hooks
        .parallel(OperationHook.Operation.Turn.Started, {
          timestamp: yield* DateTime.now,
          sessionID: "session",
        })
        .pipe(Effect.forkChild)

      yield* Deferred.await(firstStarted)
      yield* Deferred.await(secondStarted)
      yield* Deferred.succeed(releaseFirst, undefined)
      yield* Fiber.join(dispatch)
    }),
  )

  it.effect("isolates observer defects and interruption", () =>
    Effect.gen(function* () {
      const hooks = yield* OperationHook.Service
      let observed = false
      yield* hooks.register.parallel(OperationHook.Operation.Turn.Started, () => Effect.die("broken observer"))
      yield* hooks.register.parallel(OperationHook.Operation.Turn.Started, () => Effect.interrupt)
      yield* hooks.register.parallel(OperationHook.Operation.Turn.Started, () => {
        observed = true
      })

      yield* hooks.parallel(OperationHook.Operation.Turn.Started, {
        timestamp: yield* DateTime.now,
        sessionID: "session",
      })

      expect(observed).toBe(true)
    }),
  )
})
