import { describe, expect, test } from "bun:test"
import { ProviderRemoval } from "../src/provider-removal.js"

const preview = (overrides: Partial<ProviderRemoval.Result> = {}): ProviderRemoval.Result => ({
  providerID: "anthropic",
  dryRun: true,
  removed: { credentials: 0, config: false, references: [], learnedLimits: 0, hidden: false },
  configPath: "/home/user/.config/redcode/redcode.json",
  referencingFiles: [],
  envVariables: [],
  ...overrides,
})

describe("ProviderRemoval preview", () => {
  test("lists every removal effect in display order", () => {
    const result = preview({
      removed: { credentials: 2, config: true, references: ["model"], learnedLimits: 3, hidden: true },
      referencingFiles: ["/project/redcode.json"],
      envVariables: ["ANTHROPIC_API_KEY"],
    })

    expect(ProviderRemoval.items(result).map(ProviderRemoval.describe)).toEqual([
      "2 saved credential(s)",
      "Global provider configuration in /home/user/.config/redcode/redcode.json",
      "Reference: model",
      "3 learned model limit(s)",
      "Ambient provider will be hidden by policy (still set: ANTHROPIC_API_KEY)",
      "Other configuration still references this provider: /project/redcode.json",
    ])
    expect(ProviderRemoval.empty(result)).toBe(false)
  })

  test("names the router MCP server when router keys are removed", () => {
    const result = preview({
      providerID: "red-router",
      removed: { credentials: 1, config: false, references: [], learnedLimits: 0, hidden: false },
    })

    expect(ProviderRemoval.items(result)).toEqual([{ kind: "credentials", count: 1 }, { kind: "mcp" }])
  })

  test("treats a preview that only reports other references as empty", () => {
    const result = preview({ referencingFiles: ["/project/redcode.json"] })

    expect(ProviderRemoval.empty(result)).toBe(true)
    expect(ProviderRemoval.items(result)).toEqual([{ kind: "referencingFile", path: "/project/redcode.json" }])
  })
})
