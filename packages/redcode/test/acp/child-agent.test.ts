import { describe, expect, it } from "bun:test"
import {
  childAgentMetadata,
  parseChildAgentContract,
  requireGovernedChildBoundary,
} from "../../src/acp/child-agent"

const contract = {
  version: 1 as const,
  parentSessionId: "workflow-session",
  workerId: "worker-17",
  authority: "parent" as const,
  github: "parent-gateway" as const,
  permissions: "parent" as const,
}

describe("RedSkills governed child Agent contract", () => {
  it("accepts the explicit parent-owned launch contract and projects terminal metadata", () => {
    expect(parseChildAgentContract({ redskills: { childAgent: contract } })).toEqual(contract)
    expect(childAgentMetadata(contract)).toEqual({
      redskills: {
        childAgent: {
          version: 1,
          parentSessionId: "workflow-session",
          workerId: "worker-17",
          authority: "parent",
        },
      },
    })
  })

  it("refuses ambient GitHub authority in a governed child Agent", () => {
    expect(() =>
      requireGovernedChildBoundary(contract, [], {
        GITHUB_TOKEN: "leaked",
      }),
    ).toThrow(/github.*credential.*parent/i)
  })

  it("refuses the GitHub CLI credential alias in a governed child Agent", () => {
    expect(() => requireGovernedChildBoundary(contract, [], { GH_TOKEN: "leaked" })).toThrow(
      /github.*credential.*parent/i,
    )
  })

  it("refuses an MCP side channel to redskilled", () => {
    expect(() =>
      requireGovernedChildBoundary(
        contract,
        [{ name: "redskilled", command: "red-skills-redskilled-mcp", args: [], env: [] }],
        {},
      ),
    ).toThrow(/redskilled.*side channel/i)
  })

  it("refuses ambient redskilled authority in a governed child Agent", () => {
    expect(() =>
      requireGovernedChildBoundary(contract, [], {
        REDSKILLED_SOCKET: "/run/user/1000/redskilled.sock",
      }),
    ).toThrow(/redskilled.*authority.*parent/i)
  })

  it("recognizes a disguised redskilled MCP command as a side channel", () => {
    expect(() =>
      requireGovernedChildBoundary(
        contract,
        [{ name: "workflow", command: "red-skills-redskilled-mcp", args: [], env: [] }],
        {},
      ),
    ).toThrow(/redskilled.*side channel/i)
  })

  it("recognizes a disguised redskilled MCP URL as a side channel", () => {
    expect(() =>
      requireGovernedChildBoundary(
        contract,
        [{ name: "workflow", type: "http", url: "http://redskilled.local/mcp", headers: [] }],
        {},
      ),
    ).toThrow(/redskilled.*side channel/i)
  })

  it("rejects a malformed child Agent contract instead of downgrading it to an editor session", () => {
    expect(() =>
      parseChildAgentContract({
        redskills: {
          childAgent: { ...contract, authority: "self" },
        },
      }),
    ).toThrow(/invalid.*child Agent contract/i)
  })
})
