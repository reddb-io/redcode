import type { McpServer } from "@agentclientprotocol/sdk"

export type ChildAgentContract = {
  readonly version: 1
  readonly parentSessionId: string
  readonly workerId: string
  readonly authority: "parent"
  readonly github: "parent-gateway"
  readonly permissions: "parent"
}

export function parseChildAgentContract(metadata: Record<string, unknown> | null | undefined) {
  const redskills = record(metadata?.redskills)
  if (!redskills || !("childAgent" in redskills)) return
  const childAgent = record(redskills?.childAgent)
  if (
    !childAgent ||
    childAgent.version !== 1 ||
    typeof childAgent.parentSessionId !== "string" ||
    typeof childAgent.workerId !== "string" ||
    childAgent.authority !== "parent" ||
    childAgent.github !== "parent-gateway" ||
    childAgent.permissions !== "parent"
  ) {
    throw new Error("Invalid RedSkills child Agent contract")
  }
  return childAgent as ChildAgentContract
}

export function childAgentMetadata(contract: ChildAgentContract) {
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

export function requireGovernedChildBoundary(
  mcpServers: readonly McpServer[],
  env: Readonly<Record<string, string | undefined>>,
) {
  if (env.GITHUB_TOKEN || env.GH_TOKEN) {
    throw new Error("GitHub credentials belong to the parent")
  }
  if (Object.entries(env).some(([name, value]) => name.startsWith("REDSKILLED_") && value)) {
    throw new Error("redskilled authority belongs to the parent")
  }
  if (
    mcpServers.some(
      (server) =>
        server.name.toLowerCase().includes("redskilled") ||
        ("command" in server && server.command.toLowerCase().includes("redskilled")) ||
        ("url" in server && server.url.toLowerCase().includes("redskilled")),
    )
  ) {
    throw new Error("redskilled MCP side channel is forbidden for a governed child Agent")
  }
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}
