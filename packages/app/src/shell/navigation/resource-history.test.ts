import { describe, expect, test } from "bun:test"
import { executionHistory, loadHistory, recordExecutions, recordHistory, setHistoryRetention } from "./resource-history"

describe("resource history", () => {
  test("limits retention, samples and hosts and can disable saved history", () => {
    const storage = new (class {
      private data = new Map<string, string>()
      getItem(key: string) {
        return this.data.get(key) ?? null
      }
      setItem(key: string, value: string) {
        this.data.set(key, value)
      }
    })()
    const now = 200_000_000
    const point = { x: now - 120_000, cpu: 10, memory: 1, free: 2, process: 0.5 }
    setHistoryRetention(storage, 86_400_000, now)
    recordHistory(storage, "host", point, now)
    recordHistory(storage, "host", { ...point, x: point.x + 1000 }, now)
    expect(loadHistory(storage, "host", now).points).toHaveLength(1)
    expect(loadHistory(storage, "host", now + 86_400_000).points).toHaveLength(0)
    for (let i = 0; i < 9; i++) recordHistory(storage, String(i), { ...point, x: now }, now)
    expect(loadHistory(storage, "0", now).points).toHaveLength(0)
    expect(loadHistory(storage, "8", now).points).toHaveLength(1)
    setHistoryRetention(storage, 0, now)
    recordHistory(storage, "8", { ...point, x: now }, now)
    expect(loadHistory(storage, "8", now).points).toHaveLength(0)
  })

  test("recovers from invalid or unavailable client storage", () => {
    const storage = {
      getItem: () => "{bad",
      setItem: () => {
        throw new Error("quota")
      },
    }
    expect(loadHistory(storage, "host", 10_000).points).toEqual([])
    expect(() => setHistoryRetention(storage, 86_400_000, 10_000)).not.toThrow()
    expect(() =>
      recordHistory(storage, "host", { x: 9000, cpu: null, memory: null, free: null, process: 1 }, 10_000),
    ).not.toThrow()
  })

  test("bounds execution samples and deletes them when retention is disabled", () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value)
      },
    }
    const now = 200_000_000
    setHistoryRetention(storage, 86_400_000, now)
    for (let i = 0; i < 40; i++)
      recordExecutions(storage, "host", [{ kind: "task", id: String(i), residentBytes: 100 }], now)
    expect(Object.keys(executionHistory(storage, "host", now))).toHaveLength(32)
    recordExecutions(storage, "host", [{ kind: "task", id: "39", residentBytes: 200 }], now + 1000)
    expect(executionHistory(storage, "host", now + 1000)["task:39"]).toHaveLength(1)
    expect(executionHistory(storage, "host", now + 86_400_000)["task:39"]).toEqual([])
    setHistoryRetention(storage, 0, now + 1000)
    expect(executionHistory(storage, "host", now + 1000)["task:39"]).toEqual([])
  })
})
