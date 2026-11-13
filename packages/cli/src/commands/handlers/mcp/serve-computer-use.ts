import { createInterface } from "node:readline"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient } from "../auth/shared"
import type { JsonValue } from "@opencode/client"

export default Runtime.handler(
  Commands.commands.mcp.commands.serve.commands["computer-use"],
  Effect.fn("cli.mcp.serve.computer-use")(function* (input) {
    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    yield* Effect.tryPromise({
      try: async (signal) => {
        const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY, terminal: false })
        signal.addEventListener("abort", () => lines.close(), { once: true })
        for await (const line of lines) {
          if (!line.trim()) continue
          let message: unknown
          try {
            message = JSON.parse(line) as JsonValue
          } catch {
            process.stdout.write(
              JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } }) +
                "\n",
            )
            continue
          }
          try {
            const claim = await client.harness.computerUseTicket(
              { runID: input.session, hostID: input.host },
              { signal },
            )
            const response = await client.harness.computerUseMessage(
              {
                runID: input.session,
                ticket: claim.ticket,
                hostID: input.host,
                message: message as JsonValue,
              },
              { signal },
            )
            if (response !== null) process.stdout.write(JSON.stringify(response) + "\n")
          } catch (error) {
            const id =
              typeof message === "object" && message !== null && "id" in message
                ? (message as { id?: unknown }).id ?? null
                : null
            process.stdout.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                error: {
                  code: -32000,
                  message: error instanceof Error ? error.message : "Computer Use bridge failed",
                },
              }) + "\n",
            )
          }
        }
      },
      catch: (error) => (error instanceof Error ? error : new Error("Computer Use bridge failed")),
    })
  }),
)
