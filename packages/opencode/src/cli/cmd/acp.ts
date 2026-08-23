import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { ServerAuth } from "@/server/auth"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { ACPProfile } from "@/acp/profile"
import { toonStream } from "@/acp/toon-stream"
import { Readable, Writable } from "node:stream"

export const AcpCommand = effectCmd({
  command: "acp",
  describe: "start ACP (Agent Client Protocol) server",
  builder: (yargs) => {
    return withNetworkOptions(yargs)
      .option("cwd", {
        describe: "working directory",
        type: "string",
        default: process.cwd(),
      })
      .option("experimental-toon", {
        describe: "use TOON-RPC framing for ACP stdio",
        type: "boolean",
        default: false,
      })
  },
  handler: Effect.fn("Cli.acp")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("@/server/server"))
    const { ACP } = yield* Effect.promise(() => import("@/acp/agent"))
    ACPProfile.mark("cli.acp.handler")
    process.env.OPENCODE_CLIENT = "acp"
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => ACPProfile.measure("cli.acp.server.listen", () => Server.listen(opts)))

    const sdk = createOpencodeClient({
      baseUrl: `http://${server.hostname}:${server.port}`,
      headers: ServerAuth.headers(),
    })

    const input = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>
    const output = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>
    const transport = args.experimentalToon
      ? toonStream(input, output)
      : {
          ...ndJsonStream(input, output),
          closed: new Promise<void>((resolve, reject) => {
            process.stdin.once("end", resolve)
            process.stdin.once("close", resolve)
            process.stdin.once("error", reject)
          }),
        }
    const stream = transport
    const agent = ACP.init({ sdk })

    const connection = new AgentSideConnection((conn) => {
      ACPProfile.mark("cli.acp.connection.create")
      return agent.create(conn)
    }, stream)

    yield* Effect.logInfo("setup connection")
    process.stdin.resume()
    const transportFailure = transport.closed.then(() => new Promise<never>(() => undefined))
    const outputFailure = new Promise<never>((_, reject) => process.stdout.once("error", reject))
    yield* Effect.promise(() => Promise.race([connection.closed, transportFailure, outputFailure])).pipe(
      Effect.ensuring(Effect.promise(() => server.stop(true))),
    )
  }),
})
