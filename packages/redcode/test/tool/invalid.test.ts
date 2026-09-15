import { describe, expect, test } from "bun:test"
import { unknownToolMessage } from "../../src/tool/invalid"

describe("tool.invalid unknownToolMessage", () => {
  // A session with a handful of MCP servers advertises well over a hundred tools.
  const available = [
    "bash",
    "edit",
    "glob",
    "grep",
    "read",
    "write",
    "invalid",
    ...Array.from({ length: 60 }, (_, i) => `github_tool_number_${i}`),
    ...Array.from({ length: 57 }, (_, i) => `filesystem_operation_${i}`),
    "github_issue_read",
    "github_list_issues",
  ]

  test("stays under 300 bytes with 124 tools", () => {
    const message = unknownToolMessage("github_get_issue", available)
    expect(Buffer.byteLength(message)).toBeLessThan(300)
    expect(message).toContain("Unknown tool 'github_get_issue'")
    expect(message).toContain("github_issue_read")
    expect(message).not.toContain("invalid")
  })

  test("suggests near misses and prefixes", () => {
    expect(unknownToolMessage("gloob", available)).toContain("glob")
    expect(unknownToolMessage("filesystem", available)).toContain("filesystem_operation_")
  })

  test("drops suggestions rather than exceed the cap with very long tool names", () => {
    const long = Array.from({ length: 5 }, (_, i) => `github_${"x".repeat(180)}_${i}`)
    const message = unknownToolMessage(`github_${"x".repeat(180)}`, long)
    expect(Buffer.byteLength(message)).toBeLessThanOrEqual(300)
    expect(message).toContain("Check the tool name")
  })

  test("bounds a pathological name", () => {
    expect(Buffer.byteLength(unknownToolMessage("x".repeat(5000), available))).toBeLessThan(300)
  })
})
