import { describe, expect, test } from "bun:test"
import { GenerationTiming } from "../src/session/generation-timing"

// A hand-driven clock: the recorder takes it as input, so no global is touched.
const clock = (start = 1_000) => {
  let mono = start
  return {
    now: () => mono,
    epoch: () => 1_700_000_000_000 + mono,
    advance: (ms: number) => {
      mono += ms
    },
  }
}

const delta = (text: string) => ({ type: "text-delta", id: "t", text })

describe("GenerationTiming.recorder", () => {
  test("measures prep, time to first token, first visible token and the generation window", () => {
    const time = clock()
    // The message was created 250 ms before the processor started recording.
    const recorder = GenerationTiming.recorder({ created: time.epoch() - 250, now: time.now, epoch: time.epoch })
    recorder.attempt()
    time.advance(50)
    recorder.request()
    time.advance(100)
    recorder.observe({ type: "reasoning-start", id: "r" })
    recorder.handled()
    time.advance(200)
    expect(recorder.observe({ type: "reasoning-delta", id: "r", text: "" })).toBe(false)
    recorder.handled()
    time.advance(100)
    expect(recorder.observe({ type: "reasoning-delta", id: "r", text: "hmm" })).toBe(true)
    recorder.handled()
    time.advance(300)
    expect(recorder.observe(delta("Hello"))).toBe(false)
    recorder.handled()
    time.advance(500)
    recorder.observe(delta(" world"))
    recorder.handled()
    // Tool execution after the last token does not move the window.
    time.advance(45_000)
    recorder.observe({ type: "tool-result", id: "c" })

    const timing = recorder.snapshot(120)!
    expect(timing.prepMs).toBe(300)
    expect(timing.ttftMs).toBe(400)
    expect(timing.visibleMs).toBe(700)
    expect(timing.genMs).toBe(800)
    expect(timing.tokens).toBe(120)
    expect(timing.burst).toBeUndefined()
    expect(timing.firstToken! - timing.requestStarted!).toBe(400)
    expect(GenerationTiming.speed(timing)).toEqual({ type: "rate", value: 150 })
  })

  test("a tool call counts only when its input was not streamed", () => {
    const time = clock()
    const recorder = GenerationTiming.recorder({ created: time.epoch(), now: time.now, epoch: time.epoch })
    recorder.attempt()
    recorder.request()
    time.advance(100)
    expect(recorder.observe({ type: "tool-input-start", id: "a" })).toBe(false)
    expect(recorder.observe({ type: "tool-input-delta", id: "a", text: "{}" })).toBe(true)
    time.advance(1_000)
    recorder.observe({ type: "tool-call", id: "a" })
    expect(recorder.snapshot()?.genMs).toBe(0)
    time.advance(100)
    recorder.observe({ type: "tool-call", id: "b" })
    expect(recorder.snapshot()?.genMs).toBe(1_100)
  })

  test("every attempt starts over, and a retry's prep starts at the retry", () => {
    const time = clock()
    const recorder = GenerationTiming.recorder({ created: time.epoch(), now: time.now, epoch: time.epoch })
    recorder.attempt()
    time.advance(10)
    recorder.request()
    time.advance(20)
    recorder.observe(delta("partial"))
    recorder.discard()
    expect(recorder.snapshot()).toBeUndefined()
    time.advance(2_000)
    recorder.attempt()
    time.advance(30)
    recorder.request()
    time.advance(400)
    recorder.observe(delta("again"))
    const timing = recorder.snapshot()!
    expect(timing.prepMs).toBe(30)
    expect(timing.ttftMs).toBe(400)
  })

  test("events handed over back to back are one delivery", () => {
    const time = clock()
    const recorder = GenerationTiming.recorder({ created: time.epoch(), now: time.now, epoch: time.epoch })
    recorder.attempt()
    recorder.request()
    time.advance(900)
    for (const index of Array.from({ length: 50 }, (_, item) => item)) {
      recorder.observe(delta(`w${index}`))
      // Local work between events (database writes) is not a wait for the provider.
      time.advance(8)
      recorder.handled()
    }
    expect(recorder.snapshot(300)?.burst).toBe(true)
    expect(GenerationTiming.speed(recorder.snapshot(300))).toEqual({ type: "burst" })
  })

  test("a framing event that waited opens a new delivery for the delta after it", () => {
    const time = clock()
    const recorder = GenerationTiming.recorder({ created: time.epoch(), now: time.now, epoch: time.epoch })
    recorder.attempt()
    recorder.request()
    for (const _ of [1, 2, 3]) {
      time.advance(100)
      recorder.observe({ type: "text-start", id: "t" })
      recorder.handled()
      recorder.observe(delta("x"))
      recorder.handled()
    }
    expect(recorder.snapshot(300)?.burst).toBeUndefined()
  })
})

describe("GenerationTiming.speed", () => {
  const base = { firstToken: 1, genMs: 2_000, tokens: 200 }
  test("guards against numbers that measure nothing", () => {
    expect(GenerationTiming.speed(undefined)).toBeUndefined()
    expect(GenerationTiming.speed({ requestStarted: 1 })).toBeUndefined()
    expect(GenerationTiming.speed({ firstToken: 1, genMs: 500 })).toEqual({ type: "pending" })
    expect(GenerationTiming.speed({ firstToken: 1, genMs: 500 }, true)).toBeUndefined()
    expect(GenerationTiming.speed({ ...base, tokens: 19 })).toEqual({ type: "short" })
    expect(GenerationTiming.speed({ ...base, genMs: 299 })).toEqual({ type: "short" })
    expect(GenerationTiming.speed({ ...base, burst: true })).toEqual({ type: "burst" })
    expect(GenerationTiming.speed(base)).toEqual({ type: "rate", value: 100 })
  })
})

describe("GenerationTiming.meter", () => {
  const assistant = (id: string, input: Partial<GenerationTiming.Message> & { parentID?: string } = {}) => ({
    id,
    role: "assistant",
    parentID: "u1",
    time: { created: 1, completed: 2 },
    ...input,
  })
  const timing = (ttftMs: number, tokens: number, genMs: number, extra: GenerationTiming.Timing = {}) => ({
    firstToken: 10,
    ttftMs,
    tokens,
    genMs,
    ...extra,
  })

  test("skips summaries, replays and messages from before timing existed", () => {
    const messages = [
      assistant("a1", { timing: timing(500, 100, 1_000) }),
      assistant("legacy", { time: { created: 1, completed: 9 }, timing: undefined }),
      assistant("summary", { summary: true, timing: timing(5, 400, 5) }),
      assistant("replay", { timing: { replayed: true } }),
    ]
    const meter = GenerationTiming.meter(messages)!
    expect(meter.step.message.id).toBe("a1")
    expect(meter.step.latency).toBe(500)
    expect(GenerationTiming.meter([assistant("legacy")])).toBeUndefined()
  })

  test("a finished or superseded step is stale; the streaming one is live", () => {
    const live = assistant("a2", { time: { created: 3 }, timing: timing(300, 0, 0, { tokens: undefined }) })
    expect(GenerationTiming.meter([live])?.step).toMatchObject({ stale: false, speed: { type: "pending" } })
    expect(GenerationTiming.meter([assistant("a1", { timing: timing(300, 100, 1_000) })])?.step.stale).toBe(true)
    // An unfinished message with a later assistant message after it will never finish.
    const superseded = [
      assistant("a1", { time: { created: 1 }, timing: timing(300, 0, 0, { tokens: undefined }) }),
      assistant("a2", { time: { created: 3 } }),
    ]
    expect(GenerationTiming.meter(superseded)?.step).toMatchObject({ stale: true, speed: undefined })
  })

  test("an aborted step is stale and marked", () => {
    const aborted = assistant("a1", {
      error: { name: "MessageAbortedError", data: { message: "Aborted" } },
      timing: timing(300, 0, 0, { tokens: undefined }),
    })
    expect(GenerationTiming.meter([aborted])?.step).toMatchObject({ stale: true, aborted: true, latency: 300 })
  })

  test("the turn aggregates its steps: Σtokens over Σwindows, latency from its first step", () => {
    const messages = [
      assistant("old", { parentID: "u0", timing: timing(900, 1_000, 1_000) }),
      assistant("s1", { timing: timing(700, 100, 1_000) }),
      // A burst step would inflate the aggregate with a near-zero window, so it is left out.
      assistant("s2", { timing: timing(400, 500, 5, { burst: true }) }),
      assistant("s3", { timing: timing(300, 300, 1_000) }),
    ]
    const meter = GenerationTiming.meter(messages)!
    expect(meter.step.message.id).toBe("s3")
    expect(meter.step.speed).toEqual({ type: "rate", value: 300 })
    expect(meter.turn).toEqual({ steps: 3, latency: 700, speed: { type: "rate", value: 200 } })
  })

  test("a turn without a meaningful rate reports why", () => {
    const messages = [assistant("s1", { timing: timing(200, 300, 4, { burst: true }) })]
    expect(GenerationTiming.meter(messages)?.turn.speed).toEqual({ type: "burst" })
  })
})

describe("GenerationTiming formatting", () => {
  test("follows the locale", () => {
    expect(GenerationTiming.formatLatency(420, "en-US")).toBe("420ms")
    expect(GenerationTiming.formatLatency(1_850, "en-US")).toBe("1.9s")
    expect(GenerationTiming.formatLatency(12_400, "en-US")).toBe("12s")
    expect(GenerationTiming.formatRate(7.25, "en-US")).toBe("7.3 tk/s")
    expect(GenerationTiming.formatRate(1_234.6, "en-US")).toBe("1,235 tk/s")
    expect(GenerationTiming.formatLatency(1_850, "pt-BR")).toBe(
      new Intl.NumberFormat("pt-BR", {
        style: "unit",
        unit: "second",
        unitDisplay: "narrow",
        maximumFractionDigits: 1,
      }).format(1.85),
    )
    expect(GenerationTiming.formatRate(7.25, "pt-BR")).toBe("7,3 tk/s")
  })
})
