import { Effect, Option, Schema } from "effect"
import { Console } from "@opencode/schema/console"
import { ConsoleCrypto } from "@opencode/core/console/crypto"
import { Global } from "@opencode/util/global"
import { join, resolve } from "node:path"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(
  Commands.commands.console.commands.serve,
  Effect.fn("cli.console.serve")(function* (input: Runtime.Input<typeof Commands.commands.console.commands.serve>) {
    const { ConsoleHost } = yield* Effect.promise(() => import("@opencode/server/console/host"))
    const directories = yield* Global.Service
    const setupToken = ConsoleCrypto.token("rdcsetup_")
    const database = Option.isSome(input.database)
      ? resolve(input.database.value)
      : join(directories.data, "console.db")
    const host = yield* Effect.acquireRelease(
      ConsoleHost.create({ setupToken, database: { path: database } }),
      (host) => Effect.promise(host.close),
    )
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({ hostname: "127.0.0.1", port: input.port, maxRequestBodySize: 64 * 1024, fetch: host.fetch }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    const status = yield* Effect.promise(async () =>
      (await host.fetch(new Request("http://localhost/api/console/status"))).json(),
    ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Console.Status)))
    process.stdout.write(`Redcode Console: http://127.0.0.1:${server.port}\nDatabase: ${database}\n`)
    process.stdout.write("Configure identity providers in Console onboarding or authentication settings.\n")
    if (status.needsSetup)
      process.stdout.write(`Setup code: ${setupToken}\nEnter this code in the browser to create the first account.\n`)
    if (!status.needsSetup)
      process.stdout.write(
        `Infrastructure setup code: ${setupToken}\nOnly needed to claim an existing installation without an infrastructure owner.\n`,
      )
    yield* Effect.never
  }),
)
