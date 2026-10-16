import { Effect } from "effect"
import { AbsolutePath } from "@opencode/schema/schema"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { client } from "./shared"

export default Runtime.handler(Commands.commands.environments.commands.list, (input) =>
  Effect.gen(function* () {
    const api = yield* client(input.server)
    const result = yield* Effect.tryPromise((signal) =>
      api.list({ directory: AbsolutePath.make(input.directory) }, { signal }),
    )
    process.stdout.write(JSON.stringify(result, null, 2) + "\n")
  }),
)
