import { EOL } from "node:os"
import { Effect, Option } from "effect"
import type { McpServer } from "@opencode/client"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient } from "../auth/shared"

export default Runtime.handler(
  Commands.commands.mcp.commands.list,
  Effect.fn("cli.mcp.list")(function* (input) {
    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    const response = yield* Effect.promise(() => client.mcp.list({ location: { directory: process.cwd() } }))
    const servers = response.data.toSorted((a, b) => a.name.localeCompare(b.name))
    if (servers.length === 0) {
      process.stdout.write("No MCP servers configured" + EOL)
      return
    }
    const width = Math.max(...servers.map((server) => server.name.length))
    const lines = servers.map(
      (server) => `${icon(server.status)} ${server.name.padEnd(width)}  ${describe(server.status)}`,
    )
    process.stdout.write(lines.join(EOL) + EOL)
  }),
)

function icon(status: McpServer["status"]) {
  switch (status.status) {
    case "connected":
      return "✓"
    case "needs_auth":
      return "⚠"
    case "failed":
      return "✗"
    default:
      return "○"
  }
}

function describe(status: McpServer["status"]) {
  switch (status.status) {
    case "needs_auth":
      return "needs authentication"
    case "failed":
      return `failed: ${status.error}`
    default:
      return status.status
  }
}
