import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import * as NFS from "fs/promises"
import os from "os"
import path from "path"
import { ModelLimit } from "../src/model-limit"
import { SessionCompaction } from "../src/session/compaction"
import { Config } from "../src/config"

const lesson = (limit: number, extra: Partial<ModelLimit.Observed> = {}): ModelLimit.Observed => ({
  limit,
  at: 1,
  message: "m",
  ...extra,
})

describe("ModelLimit.fromNumbers", () => {
  test("keeps the provider's limit and calibrates the estimate", () => {
    const observed = ModelLimit.fromNumbers({
      numbers: { counted: 131_393, limit: 131_040 },
      output: 8_192,
      estimated: 100_000,
      message: "Input length 131393 exceeds the maximum allowed input length of 131040 tokens.",
      at: 1,
    })
    expect(observed).toEqual({
      limit: 131_040,
      counted: 131_393,
      estimated: 100_000,
      ratio: 1.31393,
      at: 1,
      message: "Input length 131393 exceeds the maximum allowed input length of 131040 tokens.",
    })
    expect(ModelLimit.inputOf(observed!, 8_192)).toBe(131_040)
  })

  test("keeps a limit that counts the completion apart from the output asked for", () => {
    const withBreakdown = ModelLimit.fromNumbers({
      numbers: { limit: 128_000, counted: 120_000, output: 10_000, includesOutput: true },
      output: 8_192,
      message: "m",
      at: 1,
    })
    expect(withBreakdown).toMatchObject({ limit: 128_000, includesOutput: true, counted: 120_000 })
    expect(ModelLimit.inputOf(withBreakdown!, 8_192)).toBe(119_808)
    // A lowered limit.output later widens the input the lesson allows, without relearning.
    expect(ModelLimit.inputOf(withBreakdown!, 4_000)).toBe(124_000)
    const total = ModelLimit.fromNumbers({
      numbers: { limit: 128_000, counted: 130_000, includesOutput: true },
      output: 8_192,
      message: "m",
      at: 1,
    })
    expect(total).toMatchObject({ limit: 128_000, includesOutput: true, counted: 130_000 - 8_192 })
  })

  test("ignores numbers that do not describe a refusal", () => {
    // "number of images exceeds the limit of 20": no model has a 20-token context.
    expect(ModelLimit.fromNumbers({ numbers: { limit: 20 }, output: 0, message: "m" })).toBeUndefined()
    expect(ModelLimit.fromNumbers({ numbers: { limit: 4_095 }, output: 0, message: "m" })).toBeUndefined()
    expect(ModelLimit.fromNumbers({ numbers: { limit: 4_096 }, output: 0, message: "m" })).toMatchObject({
      limit: 4_096,
    })
    // A quarter of what the configuration declares is the least a real limit can be.
    expect(
      ModelLimit.fromNumbers({ numbers: { limit: 30_000 }, output: 0, message: "m", declared: { context: 200_000 } }),
    ).toBeUndefined()
    expect(
      ModelLimit.fromNumbers({ numbers: { limit: 50_000 }, output: 0, message: "m", declared: { context: 200_000 } }),
    ).toMatchObject({ limit: 50_000 })
    // A count that does not exceed the limit is some other number.
    expect(
      ModelLimit.fromNumbers({ numbers: { counted: 5_000, limit: 8_000 }, output: 0, message: "m" }),
    ).toBeUndefined()
    expect(
      ModelLimit.fromNumbers({
        numbers: { counted: 100_000, output: 10_000, limit: 128_000, includesOutput: true },
        output: 0,
        message: "m",
      }),
    ).toBeUndefined()
    // A limit that leaves no room for the completion is not a limit.
    expect(
      ModelLimit.fromNumbers({ numbers: { limit: 8_000, includesOutput: true }, output: 8_000, message: "m" }),
    ).toBeUndefined()
    expect(ModelLimit.fromNumbers({ numbers: { counted: 5 }, output: 0, message: "m" })).toBeUndefined()
  })

  test("bounds the calibration and cuts a long message", () => {
    expect(ModelLimit.ratio(1, 1_000)).toBe(ModelLimit.RATIO_MIN)
    expect(ModelLimit.ratio(10_000, 1)).toBe(ModelLimit.RATIO_MAX)
    expect(ModelLimit.RATIO_MAX).toBe(1.5)
    expect(ModelLimit.ratio(1, 0)).toBeUndefined()
    const long = ModelLimit.fromNumbers({ numbers: { limit: 10_000 }, output: 0, message: "x".repeat(1_000) })
    expect(long?.message).toHaveLength(300)
  })

  test("effectiveInput takes the smaller of the declared and learned limits", () => {
    const observed = lesson(90_000)
    expect(ModelLimit.effectiveInput({ input: 100_000 }, observed, 8_000)).toBe(90_000)
    expect(ModelLimit.effectiveInput({ input: 80_000 }, observed, 8_000)).toBe(80_000)
    expect(ModelLimit.effectiveInput({}, observed, 8_000)).toBe(90_000)
    expect(ModelLimit.effectiveInput({}, lesson(90_000, { includesOutput: true }), 8_000)).toBe(82_000)
    expect(ModelLimit.effectiveInput({}, undefined, 8_000)).toBeUndefined()
    expect(ModelLimit.calibrate(1_000, { ...observed, ratio: 1.5 })).toBe(1_500)
    expect(ModelLimit.calibrate(1_000, undefined)).toBe(1_000)
    expect(ModelLimit.conservative(128_000)).toBe(115_200)
  })

  test("a request the provider accepted above the lesson raises it", () => {
    expect(ModelLimit.raised(lesson(90_000), 95_000, 8_000, 2)).toEqual(lesson(95_000, { at: 2 }))
    expect(ModelLimit.raised(lesson(90_000), 90_000, 8_000, 2)).toBeUndefined()
    expect(ModelLimit.raised(lesson(90_000, { includesOutput: true }), 85_000, 8_000, 2)).toEqual(
      lesson(93_000, { includesOutput: true, at: 2 }),
    )
    expect(ModelLimit.raised(lesson(90_000, { includesOutput: true }), 82_000, 8_000, 2)).toBeUndefined()
  })
})

describe("ModelLimit store", () => {
  const observed = (limit: number, declared?: ModelLimit.Declared) => lesson(limit, declared ? { declared } : {})

  test("remembers a lesson until the configuration declares a different limit", () =>
    Effect.gen(function* () {
      const store = ModelLimit.memory()
      yield* store.learn("router", "gpt", observed(90_000, { context: 128_000 }))
      expect(yield* store.get("router", "gpt", { context: 128_000 })).toMatchObject({ limit: 90_000 })
      expect(yield* store.list()).toEqual([
        { providerID: "router", modelID: "gpt", observed: observed(90_000, { context: 128_000 }) },
      ])
      // The person raised the limit after the lesson: their configuration wins and the lesson goes.
      expect(yield* store.get("router", "gpt", { context: 200_000 })).toBeUndefined()
      expect(yield* store.list()).toEqual([])
    }).pipe(Effect.runPromise))

  test("a lesson learned without a declared limit is dropped once one is declared", () =>
    Effect.gen(function* () {
      const store = ModelLimit.memory()
      yield* store.learn("router", "a/b", observed(90_000))
      expect(yield* store.get("router", "a/b")).toMatchObject({ limit: 90_000 })
      expect((yield* store.list())[0]).toMatchObject({ providerID: "router", modelID: "a/b" })
      expect(yield* store.get("router", "a/b", { context: 100_000 })).toBeUndefined()
      yield* store.learn("router", "a/b", observed(90_000))
      yield* store.forget("router", "a/b")
      expect(yield* store.get("router", "a/b")).toBeUndefined()
    }).pipe(Effect.runPromise))

  test("two processes over one file see each other's lessons and never undo them", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => NFS.mkdtemp(path.join(os.tmpdir(), "model-limits-")))
      const file = path.join(dir, "nested", "model-limits.json")
      const first = yield* ModelLimit.fileStore(file)
      const second = yield* ModelLimit.fileStore(file)
      yield* first.learn("router", "a", observed(90_000))
      yield* second.learn("router", "b", observed(80_000))
      // The second process did not know about "a" until it wrote, and kept it.
      expect((yield* first.list()).map((entry) => entry.modelID)).toEqual(["a", "b"])
      expect(yield* second.get("router", "a")).toMatchObject({ limit: 90_000 })
      // A lesson forgotten in one process is gone for the other, and stays gone after it writes.
      yield* second.forget("router", "a")
      expect(yield* first.get("router", "a")).toBeUndefined()
      yield* first.learn("router", "c", observed(70_000))
      expect((yield* second.list()).map((entry) => entry.modelID)).toEqual(["b", "c"])
      // Written whole and renamed into place: nothing else is left behind.
      expect((yield* Effect.promise(() => NFS.readdir(path.dirname(file)))).sort()).toEqual(["model-limits.json"])
      const parsed = JSON.parse(yield* Effect.promise(() => NFS.readFile(file, "utf8")))
      expect(Object.keys(parsed.models).sort()).toEqual(["router/b", "router/c"])
      // A file that cannot be read starts over instead of failing every request.
      yield* Effect.promise(() => NFS.writeFile(file, "{not json"))
      const third = yield* ModelLimit.fileStore(file)
      expect(yield* third.list()).toEqual([])
      yield* third.learn("router", "d", observed(60_000))
      expect((yield* first.list()).map((entry) => entry.modelID)).toEqual(["d"])
      yield* Effect.promise(() => NFS.rm(dir, { recursive: true, force: true }))
    }).pipe(Effect.runPromise))
})

describe("SessionCompaction bounds", () => {
  test("the learned limit caps both the threshold and the limit", () => {
    // The 5% margin (6,400 for a 128k window) keeps the threshold below the refusal boundary.
    expect(SessionCompaction.bounds({ context: 128_000, output: 8_000, buffer: 20_000 })).toEqual({
      threshold: 101_600,
      limit: 120_000,
    })
    expect(
      SessionCompaction.bounds({ context: 128_000, output: 8_000, buffer: 20_000, observed: lesson(90_000) }),
    ).toEqual({ threshold: 63_600, limit: 90_000 })
    expect(
      SessionCompaction.bounds({
        context: 128_000,
        output: 8_000,
        buffer: 20_000,
        observed: lesson(90_000, { includesOutput: true }),
      }),
    ).toEqual({ threshold: 55_600, limit: 82_000 })
  })

  test("declaredLimit reads the model's configured limit", () => {
    const entries = [
      new Config.Document({
        type: "document",
        info: Schema.decodeUnknownSync(Config.Info)({
          providers: { router: { models: { gpt: { limit: { context: 128_000 } } } } },
        }),
      }),
    ]
    expect(SessionCompaction.declaredLimit(entries, "router", "gpt")).toEqual({ context: 128_000 })
    expect(SessionCompaction.declaredLimit(entries, "router", "other")).toBeUndefined()
  })
})
