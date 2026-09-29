import { describe, expect, test } from "bun:test"
import { GenerationTiming } from "./generation-timing.js"

const tokens = (output: number, reasoning = 0) => ({ output, reasoning })

describe("GenerationTiming.step", () => {
  test("measures latency from dispatch and speed over the streamed window", () => {
    const step = GenerationTiming.step({
      time: { created: 1_000, first: 1_800, streamed: 3_800, completed: 5_000 },
      tokens: tokens(200),
      content: [{ type: "text", text: "answer" }],
    })
    expect(step).toEqual({ latency: 800, speed: 100, hidden: false, done: true })
  })

  test("keeps tool runs after the stream out of the rate", () => {
    // The step settled much later than the body ended; only first..streamed counts as generation.
    const step = GenerationTiming.step({
      time: { created: 0, first: 500, streamed: 1_000, completed: 60_000 },
      tokens: tokens(100),
      content: [{ type: "text", text: "x" }],
    })
    expect(step?.speed).toBe(200)
  })

  test("rates the visible output alone when reasoning did not stream", () => {
    // 1,200 reasoning tokens reported, a one-line summary streamed, then 80 tokens over 400 ms.
    const step = GenerationTiming.step({
      time: { created: 0, first: 5_000, streamed: 5_500, completed: 5_600 },
      tokens: tokens(80, 1_200),
      content: [
        { type: "reasoning", text: "Checked the config.", time: { completed: 5_100 } },
        { type: "text", text: "Done." },
      ],
    })
    expect(step?.hidden).toBe(true)
    expect(step?.speed).toBe(200)
  })

  test("counts reasoning that streamed as generation", () => {
    expect(
      GenerationTiming.reasoningHidden({
        time: { created: 0 },
        tokens: tokens(10, 10),
        content: [{ type: "reasoning", text: "x".repeat(40) }],
      }),
    ).toBe(false)
  })

  test("shows no rate for too few tokens, too short a window or missing usage", () => {
    const base = { created: 0, first: 100, streamed: 2_100 }
    expect(GenerationTiming.step({ time: base, tokens: tokens(5), content: [] })?.speed).toBeUndefined()
    expect(
      GenerationTiming.step({ time: { ...base, streamed: 200 }, tokens: tokens(500), content: [] })?.speed,
    ).toBeUndefined()
    const streaming = GenerationTiming.step({ time: base, content: [] })
    expect(streaming).toEqual({ latency: 100, speed: undefined, hidden: false, done: false })
  })

  test("measures nothing before the first block arrives", () => {
    expect(GenerationTiming.step({ time: { created: 0 }, content: [] })).toBeUndefined()
  })
})

test("GenerationTiming formats latency and rate compactly", () => {
  expect(GenerationTiming.formatLatency(850, "en-US")).toBe("850ms")
  expect(GenerationTiming.formatLatency(1_234, "en-US")).toBe("1.2s")
  expect(GenerationTiming.formatLatency(12_345, "en-US")).toBe("12s")
  expect(GenerationTiming.formatRate(84.4, "en-US")).toBe("84 tk/s")
  expect(GenerationTiming.formatRate(7.25, "en-US")).toBe("7.3 tk/s")
})
