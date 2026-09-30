import type { McpServer } from "@agentclientprotocol/sdk"
import { Option, Schema } from "effect"
import { ACPError } from "./error"

// A governed RedSkills parent launches `redcode acp` as a child Agent and attaches this contract to the
// session request as `_meta.redskills.childAgent`. Outcomes and permission requests carry the binding back,
// while GitHub access and redskilled control stay with the parent.
const Contract = Schema.Struct({
  version: Schema.Literal(1),
  parentSessionId: Schema.String,
  workerId: Schema.String,
  authority: Schema.Literal("parent"),
  github: Schema.Literal("parent-gateway"),
  permissions: Schema.Literal("parent"),
})
export type Contract = typeof Contract.Type

const decodeContract = Schema.decodeUnknownOption(Contract)

// Parses the contract and refuses a child Agent that could act with authority owned by the parent.
export function admit(
  meta: { readonly [key: string]: unknown } | null | undefined,
  mcpServers: readonly McpServer[],
  env: Readonly<Record<string, string | undefined>>,
) {
  const contract = parse(meta)
  if (contract) requireBoundary(mcpServers, env)
  return contract
}

export function parse(meta: { readonly [key: string]: unknown } | null | undefined) {
  const redskills = meta?.redskills
  if (!redskills || typeof redskills !== "object" || !("childAgent" in redskills)) return undefined
  const contract = decodeContract(redskills.childAgent)
  // A malformed contract must fail instead of silently downgrading to an ungoverned editor session.
  if (Option.isNone(contract)) {
    throw new ACPError.InvalidChildAgentError({ reason: "Invalid RedSkills child Agent contract" })
  }
  return contract.value
}

export function metadata(contract: Contract) {
  return {
    redskills: {
      childAgent: {
        version: contract.version,
        parentSessionId: contract.parentSessionId,
        workerId: contract.workerId,
        authority: contract.authority,
      },
    },
  }
}

export function requireBoundary(mcpServers: readonly McpServer[], env: Readonly<Record<string, string | undefined>>) {
  if (env.GITHUB_TOKEN || env.GH_TOKEN) {
    throw new ACPError.InvalidChildAgentError({ reason: "GitHub credentials belong to the parent" })
  }
  if (Object.entries(env).some(([name, value]) => name.startsWith("REDSKILLED_") && value)) {
    throw new ACPError.InvalidChildAgentError({ reason: "redskilled authority belongs to the parent" })
  }
  if (mcpServers.some(redskilled)) {
    throw new ACPError.InvalidChildAgentError({
      reason: "redskilled MCP side channel is forbidden for a governed child Agent",
    })
  }
}

function redskilled(server: McpServer) {
  const mentions = (value: string) => value.toLowerCase().includes("redskilled")
  if (mentions(server.name)) return true
  if ("command" in server && mentions(server.command)) return true
  return "url" in server && mentions(server.url)
}

export * as ACPChildAgent from "./child-agent"
