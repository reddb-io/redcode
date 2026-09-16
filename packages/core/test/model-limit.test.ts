import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { ModelLimit } from "../src/model-limit"
import { SessionCompaction } from "../src/session/compaction"
import { Config } from "../src/config"

describe("ModelLimit.fromNumbers", () => {
  test("keeps the provider's input limit and calibrates the estimate", () => {
    const observed = ModelLimit.fromNumbers({
      numbers: { counted: 131_393, limit: 131_040 },
      output: 8_192,
      estimated: 100_000,
      message: "Input length 131393 exceeds the maximum allowed input length of 131040 tokens.",
      at: 1,
    })
    expect(observed).toEqual({
      input: 131_040,
      counted: 131_393,
      estimated: 100_000,
      ratio: 1.31393,
      at: 1,
      message: "Input length 131393 exceeds the maximum allowed input length of 131040 tokens.",
    })
  })

  test("gives the requested output back when the provider counts input and output together", () => {
    const withBreakdown = ModelLimit.fromNumbers({
      numbers: { limit: 128_000, counted: 120_000, output: 10_000, includesOutput: true },
      output: 8_192,
      message: "m",
      at: 1,
    })
    expect(withBreakdown).toMatchObject({ input: 118_000, counted: 120_000 })
    const total = ModelLimit.fromNumbers({
      numbers: { limit: 128_000, counted: 130_000, includesOutput: true },
      output: 8_192,
      message: "m",
      at: 1,
    })
    expect(total).toMatchObject({ input: 128_000 - 8_192, counted: 130_000 - 8_192 })
  })

  test("bounds the calibration, ignores a message without a limit and cuts a long message", () => {
    expect(ModelLimit.ratio(1, 1_000)).toBe(ModelLimit.RATIO_MIN)
    expect(ModelLimit.ratio(10_000, 1)).toBe(ModelLimit.RATIO_MAX)
    expect(ModelLimit.ratio(1, 0)).toBeUndefined()
    expect(ModelLimit.fromNumbers({ numbers: { counted: 5 }, output: 0, message: "m" })).toBeUndefined()
    expect(
      ModelLimit.fromNumbers({ numbers: { limit: 100, includesOutput: true }, output: 100, message: "m" }),
    ).toBeUndefined()
    const long = ModelLimit.fromNumbers({ numbers: { limit: 10 }, output: 0, message: "x".repeat(1_000) })
    expect(long?.message).toHaveLength(300)
  })

  test("effectiveInput takes the smaller of the declared and learned limits", () => {
    const observed = { input: 90_000, at: 1, message: "m" }
    expect(ModelLimit.effectiveInput({ input: 100_000 }, observed)).toBe(90_000)
    expect(ModelLimit.effectiveInput({ input: 80_000 }, observed)).toBe(80_000)
    expect(ModelLimit.effectiveInput({}, observed)).toBe(90_000)
    expect(ModelLimit.effectiveInput({}, undefined)).toBeUndefined()
    expect(ModelLimit.calibrate(1_000, { ...observed, ratio: 1.5 })).toBe(1_500)
    expect(ModelLimit.calibrate(1_000, undefined)).toBe(1_000)
    expect(ModelLimit.conservative(128_000)).toBe(115_200)
  })
})

describe("ModelLimit store", () => {
  const observed = (input: number, declared?: ModelLimit.Declared) => ({
    input,
    at: 1,
    message: "m",
    ...(declared ? { declared } : {}),
  })

  test("remembers a lesson until the configuration declares a different limit", () =>
    Effect.gen(function* () {
      const store = ModelLimit.memory()
      yield* store.learn("router", "gpt", observed(90_000, { context: 128_000 }))
      expect(yield* store.get("router", "gpt", { context: 128_000 })).toMatchObject({ input: 90_000 })
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
      expect(yield* store.get("router", "a/b")).toMatchObject({ input: 90_000 })
      expect((yield* store.list())[0]).toMatchObject({ providerID: "router", modelID: "a/b" })
      expect(yield* store.get("router", "a/b", { context: 100_000 })).toBeUndefined()
      yield* store.learn("router", "a/b", observed(90_000))
      yield* store.forget("router", "a/b")
      expect(yield* store.get("router", "a/b")).toBeUndefined()
    }).pipe(Effect.runPromise))
})

describe("SessionCompaction bounds", () => {
  test("the learned limit caps both the threshold and the limit", () => {
    expect(SessionCompaction.bounds({ context: 128_000, output: 8_000, buffer: 20_000 })).toEqual({
      threshold: 108_000,
      limit: 120_000,
    })
    expect(
      SessionCompaction.bounds({
        context: 128_000,
        output: 8_000,
        buffer: 20_000,
        observed: { input: 90_000, at: 1, message: "m" },
      }),
    ).toEqual({ threshold: 70_000, limit: 90_000 })
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
