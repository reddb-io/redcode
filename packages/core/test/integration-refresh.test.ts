import { expect } from "bun:test"
import { Context, Deferred, Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Node } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const locations = Effect.gen(function* () {
  const layer = LayerNode.compile(LayerNode.group([Integration.node, Credential.node]), {
    shared: Node.tags.values.global,
    replacements: [Location.node.replace(Location.boundNode({ directory: AbsolutePath.make(process.cwd()) }))],
  })
  const memo = yield* Layer.makeMemoMap
  const scope = yield* Effect.scope
  const first = yield* Layer.buildWithMemoMap(layer, memo, scope)
  const second = yield* Layer.buildWithMemoMap(layer, memo, scope)
  const a = Context.get(first, Integration.Service)
  const b = Context.get(second, Integration.Service)
  const credentials = Context.get(first, Credential.Service)
  expect(a).not.toBe(b)
  expect(credentials).toBe(Context.get(second, Credential.Service))
  return { a, b, credentials }
})

for (const cancel of [false, true]) {
  it.effect(`shares refresh across Locations${cancel ? " when the first waiter stops" : ""}`, () =>
    Effect.gen(function* () {
      const services = yield* locations
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const integrationID = Integration.ID.make("fixture")
      const methodID = Integration.MethodID.make("oauth")
      let calls = 0
      const registration = {
        integrationID,
        method: { id: methodID, type: "oauth" as const, label: "OAuth" },
        authorize: () => Effect.die("unused sign-in"),
        refresh: (value: Credential.OAuth) =>
          Effect.gen(function* () {
            calls++
            expect(value.refresh).toBe("old-refresh")
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            return Credential.OAuth.make({ ...value, access: "new-access", refresh: "new-refresh", expires: 1e15 })
          }),
      }
      yield* services.a.transform((editor) => editor.method.update(registration))
      yield* services.b.transform((editor) => editor.method.update(registration))
      const stored = yield* services.credentials.create({
        integrationID,
        value: Credential.OAuth.make({ type: "oauth", methodID, access: "old", refresh: "old-refresh", expires: 1 }),
      })
      const connection = { type: "credential" as const, id: stored.id, label: stored.label, method: "oauth" as const }
      const first = yield* services.a.connection.resolve(connection).pipe(Effect.forkScoped)
      yield* Deferred.await(entered)
      if (cancel) yield* Fiber.interrupt(first)
      const second = yield* services.b.connection.resolve(connection).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      expect(calls).toBe(1)
      yield* Deferred.succeed(release, undefined)
      const value = yield* Fiber.join(second)
      if (!cancel) expect(yield* Fiber.join(first)).toEqual(value)
      expect((yield* services.credentials.get(stored.id))?.value).toEqual(value)
      expect(yield* services.a.connection.resolve(connection)).toEqual(value)
      expect(calls).toBe(1)
    }),
  )
}

it.effect("shares a failed refresh but permits a later retry", () =>
  Effect.gen(function* () {
    const services = yield* locations
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const error = new Error("endpoint unavailable")
    let calls = 0
    const operation = Effect.gen(function* () {
      calls++
      yield* Deferred.succeed(entered, undefined)
      yield* Deferred.await(release)
      return yield* Effect.fail(error)
    })
    const id = Credential.ID.make("cred_failure")
    const first = yield* services.credentials.lock(id, operation).pipe(Effect.flip, Effect.forkScoped)
    yield* Deferred.await(entered)
    const second = yield* services.credentials.lock(id, operation).pipe(Effect.flip, Effect.forkScoped)
    yield* Effect.yieldNow
    yield* Deferred.succeed(release, undefined)
    expect(yield* Fiber.join(first)).toBe(error)
    expect(yield* Fiber.join(second)).toBe(error)
    expect(calls).toBe(1)
    expect(yield* services.credentials.lock(id, Effect.undefined)).toBeUndefined()
  }),
)

it.effect("times out a stuck refresh and never restores a removed account", () =>
  Effect.gen(function* () {
    const services = yield* locations
    const entered = yield* Deferred.make<void>()
    const integrationID = Integration.ID.make("fixture")
    const methodID = Integration.MethodID.make("oauth")
    yield* services.a.transform((editor) =>
      editor.method.update({
        integrationID,
        method: { id: methodID, type: "oauth", label: "OAuth" },
        authorize: () => Effect.die("unused sign-in"),
        refresh: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
      }),
    )
    const stored = yield* services.credentials.create({
      integrationID,
      value: Credential.OAuth.make({ type: "oauth", methodID, access: "old", refresh: "old", expires: 1 }),
    })
    const connection = { type: "credential" as const, id: stored.id, label: stored.label, method: "oauth" as const }
    const waiting = yield* services.a.connection.resolve(connection).pipe(Effect.flip, Effect.forkScoped)
    yield* Deferred.await(entered)
    yield* services.credentials.remove(stored.id)
    yield* TestClock.adjust("31 seconds")
    expect(yield* Fiber.join(waiting)).toBeInstanceOf(Integration.AuthorizationError)
    expect(yield* services.a.connection.resolve(connection)).toBeUndefined()
    expect(yield* services.credentials.list(integrationID)).toEqual([])
  }),
)
