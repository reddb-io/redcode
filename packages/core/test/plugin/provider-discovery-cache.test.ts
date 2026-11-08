import { describe, expect, test } from "bun:test"
import { cached, remember } from "@opencode/core/plugin/provider/discovery-cache"

describe("provider discovery cache", () => {
  test("evicts the least recently used endpoint", () => {
    const cache = new Map<string, number>()
    remember(cache, "first", 1, 2)
    remember(cache, "second", 2, 2)
    expect(cached(cache, "first")).toBe(1)
    remember(cache, "third", 3, 2)
    expect([...cache.entries()]).toEqual([
      ["first", 1],
      ["third", 3],
    ])
    expect(cached(cache, "second")).toBeUndefined()
  })
})
