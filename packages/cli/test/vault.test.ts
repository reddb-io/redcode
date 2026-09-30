import { describe, expect, test } from "bun:test"
import { importSummary, pipedValue } from "../src/commands/handlers/vault/shared"

describe("vault command output", () => {
  test("drops only the trailing line break of a piped value", () => {
    const value = "ghp" + "_" + "a".repeat(36)
    expect(pipedValue(value + "\n")).toBe(value)
    expect(pipedValue(value + "\r\n")).toBe(value)
    expect(pipedValue(value + "\n\n")).toBe(value + "\n")
    expect(pipedValue(" " + value)).toBe(" " + value)
    expect(pipedValue("\n")).toBe("")
  })

  test("lists the stored references and the skipped lines", () => {
    expect(importSummary({ names: ["github-token", "db-password"], skipped: 2 })).toEqual([
      "Imported 2 secrets: {vault:github-token}, {vault:db-password}",
      "Skipped 2 lines",
    ])
    expect(importSummary({ names: ["github-token"], skipped: 1 })).toEqual([
      "Imported 1 secret: {vault:github-token}",
      "Skipped 1 line",
    ])
    expect(importSummary({ names: [], skipped: 0 })).toEqual(["Imported 0 secrets"])
  })
})
