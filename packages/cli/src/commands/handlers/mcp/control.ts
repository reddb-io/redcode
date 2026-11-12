import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient, request } from "../auth/shared"

const operate = Effect.fn("cli.mcp.control")(function* (
  action: "connect" | "disconnect" | "reconnect" | "restart" | "reload",
  input: { name?: string; server: Option.Option<string>; standalone: boolean },
) {
  const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
  const location = { directory: process.cwd() }
  if (action === "restart" || action === "reload") {
    yield* request((signal) => client.mcp[action]({ location }, { signal }))
    process.stdout.write(
      (action === "restart" ? "Reconnected enabled MCP servers" : "Reloaded MCP configuration") + EOL,
    )
    return
  }
  const target = { server: input.name!, location }
  if (action === "reconnect") {
    yield* request((signal) => client.mcp.disconnect(target, { signal }))
    yield* request((signal) => client.mcp.connect(target, { signal }))
  } else yield* request((signal) => client.mcp[action](target, { signal }))
  const snapshot = yield* request((signal) => client.mcp.list({ location }, { signal }))
  const server = snapshot.data.find((item) => item.name === input.name)
  if (!server) return yield* Effect.fail(new Error(`MCP server not found: ${input.name}`))
  if (server.status.status === "needs_auth")
    return yield* Effect.fail(
      new Error(
        `${input.name}: ${server.status.error}. Run redcode mcp auth ${JSON.stringify(input.name)} to sign in again.`,
      ),
    )
  if (server.status.status === "failed") return yield* Effect.fail(new Error(`${input.name}: ${server.status.error}`))
  process.stdout.write(`${input.name}: ${server.status.status} (runtime only; saved configuration unchanged)` + EOL)
})

export const connect = Runtime.handler(Commands.commands.mcp.commands.connect, (input) => operate("connect", input))
export const disconnect = Runtime.handler(Commands.commands.mcp.commands.disconnect, (input) =>
  operate("disconnect", input),
)
export const reconnect = Runtime.handler(Commands.commands.mcp.commands.reconnect, (input) =>
  operate("reconnect", input),
)
export const restart = Runtime.handler(Commands.commands.mcp.commands.restart, (input) => operate("restart", input))
export const reload = Runtime.handler(Commands.commands.mcp.commands.reload, (input) => operate("reload", input))
