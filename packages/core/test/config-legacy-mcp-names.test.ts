import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Config } from "@reddb-io/redcode-core/config"

describe("Config legacy MCP names", () => {
  test("finds permission rules and hook matchers still written for the old mcp_ key", () => {
    const info = Schema.decodeUnknownSync(Config.Info)({
      permissions: [
        { action: "mcp_github_*", resource: "*", effect: "deny" },
        { action: "github_search", resource: "*", effect: "allow" },
      ],
      agents: { build: { permissions: [{ action: "mcp_linear_create", resource: "*", effect: "ask" }] } },
    })
    expect(Config.legacyMcpPatterns(info)).toEqual(["mcp_github_*", "mcp_linear_create"])
    expect(Config.legacyMcpPatterns(Schema.decodeUnknownSync(Config.Info)({}))).toEqual([])
  })
})
