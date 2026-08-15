import { describe, expect, test } from "bun:test"
import { bar, formatAge, formatCount, formatDuration, sparkline, truncate } from "../../src/routes/workers/format"
import { empty, rate, record, series, type Payload, type Worker } from "../../src/routes/workers/history"

type WorkerInput = Omit<Partial<Worker>, "display"> & {
  worker_id: string
  display?: Partial<NonNullable<Worker["display"]>>
}

function worker(input: WorkerInput): Worker {
  const { display, ...rest } = input
  return {
    project_label: "reddb-io/redcode",
    pid: 100,
    started_at: "2026-08-15T20:00:00.000Z",
    uptime_ms: 60_000,
    vitals: { rss_bytes: 1024 ** 2 * 400, sampled_at: "2026-08-15T20:01:00.000Z", age_ms: 500, fresh: true },
    budget: { declared: "2G", bytes: 2 * 1024 ** 3, used_bytes: 1024 ** 3, used_fraction: 0.5, enforceable: true },
    log: { last_line: "booting", published_at: "2026-08-15T20:00:30.000Z" },
    ...rest,
    display: {
      runner: "claude",
      model: "claude-fable-5",
      effort: "high",
      origin: "afk",
      issue: "123",
      phase: "implement",
      step: "edit",
      phase_index: 2,
      phase_total: 5,
      failed: false,
      heartbeat: "2026-08-15T20:00:59.000Z",
      started_at: "2026-08-15T20:00:00.000Z",
      context: 0.3,
      eta: 240,
      added: 10,
      removed: 2,
      tokens: 1_000,
      tools: 5,
      reasoning: 200,
      text: 100,
      ...display,
    },
  }
}

function payload(generated_at: string, workers: Worker[]): Payload {
  return {
    version: 1,
    generated_at,
    daemon: { pid: 1, daemon_version: "3.18.12", protocol_version: 1, started_at: "2026-08-15T19:00:00.000Z" },
    staleness: {
      sampled_at: generated_at,
      age_ms: 100,
      threshold_ms: 5_000,
      stale: false,
      measured_worker_count: workers.length,
      unmeasured_workers: [],
      reason: "fresh",
    },
    host: {
      worker_count: workers.length,
      project_count: 1,
      observed_rss_bytes: 1024 ** 3,
      measured_worker_count: workers.length,
      ceiling_used_fraction: 0.25,
      ceiling: { memory_bytes: 4 * 1024 ** 3, worker_count: 6, interactive_reservation: 1 },
    },
    registered_projects: ["reddb-io/redcode"],
    workers,
  }
}

describe("workers history", () => {
  test("records samples, activity transitions, and departures", () => {
    const t0 = Date.parse("2026-08-15T20:01:00.000Z")
    let history = record(empty(), payload("g1", [worker({ worker_id: "h1" })]), t0)
    expect(Object.keys(history.live)).toEqual(["h1"])
    expect(history.live.h1.samples).toHaveLength(1)
    expect(history.live.h1.activity.map((item) => item.kind)).toEqual(["start"])

    // Same generated_at → nothing new, same object back.
    expect(record(history, payload("g1", [worker({ worker_id: "h1" })]), t0 + 1_000)).toBe(history)

    history = record(
      history,
      payload("g2", [
        worker({
          worker_id: "h1",
          display: { phase: "gate", step: "run tests", tokens: 4_000, tools: 9 },
          log: { last_line: "bun test", published_at: "x" },
        }),
        worker({ worker_id: "h2", display: { issue: "124" } }),
      ]),
      t0 + 30_000,
    )
    expect(history.live.h1.samples).toHaveLength(2)
    expect(history.live.h1.activity.map((item) => item.text)).toEqual([
      "started on #123",
      "phase implement → gate",
      "step run tests",
      "bun test",
    ])
    expect(history.live.h2.activity[0].text).toBe("started on #124")

    history = record(history, payload("g3", [worker({ worker_id: "h2" })]), t0 + 60_000)
    expect(Object.keys(history.live)).toEqual(["h2"])
    expect(history.departed.map((item) => item.worker.worker_id)).toEqual(["h1"])
    expect(history.departed[0].ended).toBe(t0 + 60_000)
    expect(history.departed[0].worker.display?.phase).toBe("gate")
  })

  test("rate and series derive velocity from monotonic counters", () => {
    const now = 1_000_000
    const samples = [
      { at: now - 60_000, tokens: 1_000, tools: 1 },
      { at: now - 30_000, tokens: 2_500, tools: 3 },
      { at: now, tokens: 4_000, tools: 5 },
    ]
    expect(rate(samples, "tokens", now)).toBe(3_000)
    expect(rate(samples, "tools", now)).toBe(4)
    expect(rate(samples.slice(-1), "tokens", now)).toBeNull()
    expect(rate([{ at: now - 10_000, tokens: 9, tools: 0 }, { at: now, tokens: 1, tools: 0 }], "tokens", now)).toBeNull()

    const buckets = series(samples, "tokens", 6, 10_000, now)
    expect(buckets).toHaveLength(6)
    expect(buckets.reduce((sum, item) => sum + item, 0)).toBe(3_000)
    // Short history only covers the trailing buckets so the sparkline can pad the prefix.
    expect(series(samples.slice(-2), "tokens", 6, 10_000, now)).toHaveLength(3)
  })
})

describe("workers format", () => {
  test("bars and sparklines are fixed width", () => {
    expect(bar(0.5, 6)).toBe("███░░░")
    expect(bar(null, 4)).toBe("░░░░")
    expect(bar(2, 3)).toBe("███")
    expect(sparkline([0, 1, 2, 4], 6)).toBe("··▁▃▅█")
    expect(sparkline([], 3)).toBe("···")
  })

  test("compact numbers and durations", () => {
    expect(formatCount(950)).toBe("950")
    expect(formatCount(4_210)).toBe("4.2k")
    expect(formatCount(42_100)).toBe("42k")
    expect(formatCount(1_200_000)).toBe("1.2M")
    expect(formatCount(8_000)).toBe("8k")
    expect(formatCount(null)).toBe("?")
    expect(formatDuration(42_000)).toBe("42s")
    expect(formatDuration(5_400_000)).toBe("1.5h")
    expect(formatAge(400)).toBe("now")
    expect(formatAge(null)).toBe("?")
    expect(truncate("abcdefgh", 5)).toBe("abcd…")
  })
})
