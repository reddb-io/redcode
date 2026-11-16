import { expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Logger } from "effect"
import { FileSystem } from "@opencode/schema/filesystem"
import { RelativePath } from "../../src/schema"
import { runtimeFallback } from "../../src/filesystem/search-runtime-fallback"

test("concurrent runtime failures dispose once before lazily using legacy", async () => {
  let disposals = 0
  let builds = 0
  let calls = 0
  const warnings: unknown[] = []
  const gate = Deferred.makeUnsafe<void>()
  const service = runtimeFallback({
    service: { find: () => Deferred.await(gate).pipe(Effect.andThen(Effect.die(new Error("injected")))) },
    dispose: Effect.sync(() => { disposals++ }),
  }, Effect.sync(() => {
    if (disposals !== 1) throw new Error("legacy built before Rust disposal")
    builds++
    return { find: () => Effect.sync(() => { calls++; return [FileSystem.Entry.make({ path: RelativePath.make("ok.ts"), type: "file" })] }) }
  }))
  expect(builds).toBe(0)
  const results = await Effect.runPromise(Effect.gen(function* () {
    const batch = yield* Effect.forkChild(Effect.all(Array.from({ length: 20 }, () => service.find({ query: "ok" })), { concurrency: "unbounded" }))
    yield* Deferred.succeed(gate, undefined)
    return yield* Fiber.join(batch)
  }).pipe(Effect.provide(Logger.layer([Logger.map(Logger.formatStructured, (entry) => warnings.push(entry.message))]))))
  expect(results).toHaveLength(20)
  expect(results.every((entries) => entries[0]?.path === "ok.ts")).toBe(true)
  expect({ disposals, builds, calls }).toEqual({ disposals: 1, builds: 1, calls: 20 })
  expect(warnings).toHaveLength(1)
  expect(Array.isArray(warnings[0]) && warnings[0][0]).toBe("native filename search failed; using legacy rollback")
})

test("interrupting a Rust search does not trigger fallback", async () => {
  let disposals = 0
  let builds = 0
  const started = Deferred.makeUnsafe<void>()
  const service = runtimeFallback({
    service: { find: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)) },
    dispose: Effect.sync(() => { disposals++ }),
  }, Effect.sync(() => { builds++; return { find: () => Effect.succeed([]) } }))
  await Effect.runPromise(Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(service.find({ query: "cancel" }))
    yield* Deferred.await(started)
    yield* Fiber.interrupt(fiber)
  }))
  expect({ disposals, builds }).toEqual({ disposals: 0, builds: 0 })
})
