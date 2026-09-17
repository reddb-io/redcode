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

const started = (time: ReturnType<typeof clock>) => {
  const recorder = GenerationTiming.recorder({ created: time.epoch(), now: time.now, epoch: time.epoch })
  recorder.attempt()
  recorder.request()
  return recorder
}

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
    time.advance(200)
    expect(recorder.observe({ type: "reasoning-delta", id: "r", text: "" })).toBe(false)
    time.advance(100)
    expect(recorder.observe({ type: "reasoning-delta", id: "r", text: "hmm, the parser first" })).toBe(true)
    time.advance(300)
    expect(recorder.observe(delta("Hello"))).toBe(false)
    time.advance(500)
    recorder.observe(delta(" world"))
    // Tool execution after the last token does not move the window.
    time.advance(45_000)
    recorder.observe({ type: "tool-result", id: "c" })

    const timing = recorder.snapshot({ output: 110, reasoning: 10 })!
    expect(timing).toMatchObject({
      prepMs: 300,
      ttftMs: 400,
      visibleMs: 700,
      genMs: 800,
      visibleGenMs: 500,
      idleMs: 800,
      outputTokens: 110,
      reasoningTokens: 10,
      reasoningChars: 21,
    })
    expect(timing.burst).toBeUndefined()
    expect(timing.firstToken! - timing.requestStarted!).toBe(400)
    expect(GenerationTiming.speed(timing)).toEqual({ type: "rate", value: 150 })
  })

  test("uses the arrival stamp it is given, not the time the event is handled", () => {
    const time = clock()
    const recorder = started(time)
    const arrivals = [1_100, 1_140, 1_180]
    time.advance(900)
    arrivals.forEach((at) => recorder.observe(delta("x"), at))
    const timing = recorder.snapshot({ output: 30, reasoning: 0 })!
    expect(timing.ttftMs).toBe(100)
    expect(timing.genMs).toBe(80)
  })

  test("a tool call counts only when its input was not streamed", () => {
    const time = clock()
    const recorder = started(time)
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
    const recorder = started(time)
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
    expect(recorder.snapshot()).toMatchObject({ prepMs: 30, ttftMs: 400 })
  })

  test("a status retry inside one attempt restarts the request clock", () => {
    const time = clock()
    const recorder = started(time)
    // 429, then the executor waits out retry-after before the second HTTP attempt.
    time.advance(5_000)
    recorder.request()
    time.advance(300)
    recorder.observe(delta("answer"))
    expect(recorder.snapshot()?.ttftMs).toBe(300)
  })
})

describe("GenerationTiming burst detection", () => {
  test("a fast provider 3 ms apart with light handling is a stream", () => {
    const time = clock()
    const recorder = started(time)
    time.advance(500)
    for (const index of Array.from({ length: 200 }, (_, item) => item)) {
      recorder.observe(delta(`w${index}`))
      recorder.busy(delta("w"), time.now(), time.now() + 0.4)
      time.advance(3)
    }
    const timing = recorder.snapshot({ output: 200, reasoning: 0 })!
    expect(timing.burst).toBeUndefined()
    expect(GenerationTiming.speed(timing)).toMatchObject({ type: "rate" })
  })

  test("a buffered burst spread out by handling stalls is a burst", () => {
    const time = clock()
    const recorder = started(time)
    time.advance(2_000)
    // Everything is already buffered; each arrival waits for the previous event's database write.
    for (const index of Array.from({ length: 60 }, (_, item) => item)) {
      recorder.observe(delta(`w${index}`))
      recorder.busy(delta("w"), time.now(), time.now() + 8)
      time.advance(8)
    }
    const timing = recorder.snapshot({ output: 400, reasoning: 0 })!
    expect(timing.genMs).toBe(472)
    expect(timing.idleMs).toBe(0)
    expect(timing.burst).toBe(true)
    expect(GenerationTiming.speed(timing)).toEqual({ type: "burst" })
  })

  test("a hook that waits outside the event loop does not make a stream look like a burst", () => {
    const time = clock()
    const recorder = started(time)
    time.advance(100)
    const start = time.now()
    for (const index of Array.from({ length: 12 }, (_, item) => item)) {
      if (index === 6) recorder.busy({ type: "text-end" }, time.now(), time.now() + 900)
      recorder.observe(delta(`w${index}`))
      time.advance(40)
    }
    const timing = recorder.snapshot({ output: 120, reasoning: 0 })!
    expect(time.now() - start).toBe(480)
    expect(timing).toMatchObject({ genMs: 440, idleMs: 440 })
    expect(timing.burst).toBeUndefined()
  })

  test("handling after the last arrival does not count against the window", () => {
    const time = clock()
    const recorder = started(time)
    time.advance(100)
    for (const _ of [1, 2, 3, 4, 5]) {
      recorder.observe(delta("x"))
      time.advance(100)
    }
    // A slow text-end hook runs after the stream is over.
    recorder.busy(delta("x"), time.now(), time.now() + 5_000)
    const timing = recorder.snapshot({ output: 50, reasoning: 0 })!
    expect(timing).toMatchObject({ genMs: 400, idleMs: 400 })
    expect(timing.burst).toBeUndefined()
  })
})

describe("GenerationTiming.arrivals", () => {
  test("hands out stamps in order for events that carry output, and the current time otherwise", () => {
    const time = clock()
    const queue = GenerationTiming.arrivals(time.now)
    queue.arrived()
    time.advance(10)
    queue.arrived()
    time.advance(500)
    expect(queue.take({ type: "text-start" })).toBe(1_510)
    expect(queue.take(delta("a"))).toBe(1_000)
    expect(queue.take({ type: "tool-call" })).toBe(1_010)
    expect(queue.take(delta("b"))).toBe(1_510)
    queue.arrived()
    queue.clear()
    expect(queue.take(delta(""))).toBe(1_510)
  })
})

describe("GenerationTiming.speed", () => {
  const base = { firstToken: 1, genMs: 2_000, visibleGenMs: 1_000, outputTokens: 200, reasoningTokens: 0 }
  test("guards against numbers that measure nothing", () => {
    expect(GenerationTiming.speed(undefined)).toBeUndefined()
    expect(GenerationTiming.speed({ requestStarted: 1 })).toBeUndefined()
    expect(GenerationTiming.speed({ firstToken: 1, genMs: 500 })).toEqual({ type: "pending" })
    expect(GenerationTiming.speed({ firstToken: 1, genMs: 500 }, true)).toBeUndefined()
    expect(GenerationTiming.speed({ ...base, outputTokens: 19 })).toEqual({ type: "short" })
    expect(GenerationTiming.speed({ ...base, genMs: 299 })).toEqual({ type: "short" })
    expect(GenerationTiming.speed({ ...base, burst: true })).toEqual({ type: "burst" })
    expect(GenerationTiming.speed(base)).toEqual({ type: "rate", value: 100 })
  })

  test("reasoning that streamed counts with the output over the whole window", () => {
    // 600 reasoning tokens with about 4 characters each streamed.
    const timing = { ...base, outputTokens: 200, reasoningTokens: 600, reasoningChars: 2_300 }
    expect(GenerationTiming.speed(timing)).toEqual({ type: "rate", value: 400 })
  })

  test("reasoning that did not stream is left out: the visible output over the visible window", () => {
    // 1,200 hidden reasoning tokens, a short summary, then 80 text tokens over 780 ms.
    const timing = {
      firstToken: 1,
      genMs: 800,
      visibleGenMs: 780,
      outputTokens: 80,
      reasoningTokens: 1_200,
      reasoningChars: 60,
    }
    expect(GenerationTiming.reasoningHidden(timing)).toBe(true)
    const speed = GenerationTiming.speed(timing)
    expect(speed).toMatchObject({ type: "rate", hidden: true })
    expect(speed?.type === "rate" ? Math.round(speed.value) : 0).toBe(103)
    // Counting all 1,280 tokens over the window would have claimed 1,600 tk/s.
    expect(GenerationTiming.reasoningHidden({ reasoningTokens: 1_200, reasoningChars: 2_400 })).toBe(false)
    expect(GenerationTiming.reasoningHidden({ reasoningTokens: 1_200 })).toBe(true)
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
  const timing = (ttftMs: number, outputTokens: number, genMs: number, extra: GenerationTiming.Timing = {}) => ({
    firstToken: 10,
    ttftMs,
    outputTokens,
    reasoningTokens: 0,
    genMs,
    visibleGenMs: genMs,
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
    const live = assistant("a2", { time: { created: 3 }, timing: timing(300, 0, 0, { outputTokens: undefined }) })
    expect(GenerationTiming.meter([live])?.step).toMatchObject({ stale: false, speed: { type: "pending" } })
    expect(GenerationTiming.meter([assistant("a1", { timing: timing(300, 100, 1_000) })])?.step.stale).toBe(true)
    // An unfinished message with a later assistant message after it will never finish.
    const superseded = [
      assistant("a1", { time: { created: 1 }, timing: timing(300, 0, 0, { outputTokens: undefined }) }),
      assistant("a2", { time: { created: 3 } }),
    ]
    expect(GenerationTiming.meter(superseded)?.step).toMatchObject({ stale: true, speed: undefined })
  })

  test("an aborted step is stale and marked", () => {
    const aborted = assistant("a1", {
      error: { name: "MessageAbortedError", data: { message: "Aborted" } },
      timing: timing(300, 0, 0, { outputTokens: undefined }),
    })
    expect(GenerationTiming.meter([aborted])?.step).toMatchObject({ stale: true, aborted: true, latency: 300 })
  })

  test("the turn aggregates its rated steps and says how many were rated", () => {
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
    expect(meter.turn).toEqual({ steps: 3, rated: 2, latency: 700, speed: { type: "rate", value: 200 } })
  })

  test("a turn without a meaningful rate reports why", () => {
    const messages = [assistant("s1", { timing: timing(200, 300, 4, { burst: true }) })]
    expect(GenerationTiming.meter(messages)?.turn).toMatchObject({ rated: 0, speed: { type: "burst" } })
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
