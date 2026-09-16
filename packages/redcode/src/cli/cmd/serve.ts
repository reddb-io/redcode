import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@reddb-io/redcode-core/flag/flag"
import { BootTrace } from "@reddb-io/redcode-core/observability/boot-trace"
import { RpcPath } from "@reddb-io/redcode-protocol/rpc"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless Redcode server",
  // Server loads instances per-request via x-opencode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    if (!Flag.REDCODE_SERVER_PASSWORD) {
      console.log("Warning: REDCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`Redcode server listening on http://${server.hostname}:${server.port}`)
    console.log(`Redcode RPC endpoint: http://${server.hostname}:${server.port}${RpcPath}`)
    // A headless server has no screen to render: listening is where its boot ends.
    BootTrace.stop("serve.ready", { hostname: server.hostname, port: server.port })

    // Until told to stop. Returning, rather than dying on the signal, lets the command finish
    // and the process close the runtime — and with it the database — on its way out. The
    // handlers are one-shot on purpose: a second Ctrl-C while that is under way falls through to
    // the default handler and exits the process at once.
    yield* Effect.callback<void>((resume) => {
      const stop = () => resume(Effect.void)
      process.once("SIGINT", stop)
      process.once("SIGTERM", stop)
      return Effect.sync(() => {
        process.off("SIGINT", stop)
        process.off("SIGTERM", stop)
      })
    })
    yield* Effect.promise(() => server.stop(true))
  }),
})
