import { describe, expect, test } from "bun:test"
import { COMPACTION_MS, deadlineMs, message, TITLE_MS } from "@/session/aux-deadline"

describe("deadlines for the calls around a turn", () => {
  test("bounds both, and gives compacting the longer rope", () => {
    // Naming is one short request; compacting reads the whole conversation back.
    expect(deadlineMs("title")).toBe(TITLE_MS)
    expect(deadlineMs("compaction")).toBe(COMPACTION_MS)
    expect(COMPACTION_MS).toBeGreaterThan(TITLE_MS)
  })

  test("configuration overrides, and false or zero removes the bound", () => {
    expect(deadlineMs("title", 5_000)).toBe(5_000)
    expect(deadlineMs("title", false)).toBeUndefined()
    expect(deadlineMs("compaction", 0)).toBeUndefined()
  })

  test("says which call gave up, and for how long it waited", () => {
    expect(message("title", 120_000)).toContain("Naming the session")
    expect(message("compaction", 600_000)).toContain("600s")
  })
})
