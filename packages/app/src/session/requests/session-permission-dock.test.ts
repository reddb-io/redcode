import { describe, expect, test } from "bun:test"
import { permissionInputLines } from "./session-permission-dock"

describe("permission input", () => {
  test("formats strings and structured MCP arguments without truncating them", () => {
    const body = "x".repeat(3_000)
    expect(
      permissionInputLines({
        input: { issueId: "ENG-1", labels: ["bug"], enabled: true, body },
      }),
    ).toEqual(["issueId: ENG-1", 'labels: ["bug"]', "enabled: true", `body: ${body}`])
  })

  test("ignores malformed non-record inputs", () => {
    expect(permissionInputLines(undefined)).toEqual([])
    expect(permissionInputLines({ input: "not an object" })).toEqual([])
    expect(permissionInputLines({ input: ["not", "a", "record"] })).toEqual([])
  })
})
