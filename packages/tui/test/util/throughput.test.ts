import { describe, expect, test } from "bun:test"
import { Throughput } from "../../src/util/throughput"

const msg = (time: { created: number; first?: number; completed?: number }, output = 200, reasoning = 100) => ({
  tokens: { output, reasoning },
  time,
})

describe("Throughput", () => {
  test("latency is request to first chunk; speed is tokens from first chunk to completion", () => {
    const info = Throughput.of(msg({ created: 1_000, first: 1_800, completed: 4_800 }))
    expect(info.latency).toBe(800)
    expect(info.speed).toBe(100)
  })

  test("no first chunk means nothing to say; still streaming means latency only", () => {
    expect(Throughput.of(msg({ created: 1_000 }))).toEqual({})
    expect(Throughput.of(msg({ created: 1_000, first: 1_300 }))).toEqual({ latency: 300 })
    expect(Throughput.of(msg({ created: 1_000, first: 1_300, completed: 2_300 }, 0, 0))).toEqual({ latency: 300 })
  })

  test("formats for the footer", () => {
    expect(Throughput.formatLatency(420)).toBe("420ms")
    expect(Throughput.formatLatency(1_850)).toBe("1.9s")
    expect(Throughput.formatLatency(12_400)).toBe("12s")
    expect(Throughput.formatSpeed(7.25)).toBe("7.3 tk/s")
    expect(Throughput.formatSpeed(84.6)).toBe("85 tk/s")
  })
})
