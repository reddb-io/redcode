import { describe, expect, test } from "bun:test"
import { terminalTabLabel } from "./terminal-label"

describe("terminalTabLabel", () => {
  test("returns custom title unchanged", () => {
    const label = terminalTabLabel({ title: "server", titleNumber: 3 })
    expect(label).toBe("server")
  })

  test("normalizes default numbered title", () => {
    const label = terminalTabLabel({ title: "Terminal 2", titleNumber: 2 })
    expect(label).toBe("Terminal 2")
  })

  test("falls back to generic title", () => {
    const label = terminalTabLabel({ title: "", titleNumber: 0 })
    expect(label).toBe("Terminal")
  })
})
