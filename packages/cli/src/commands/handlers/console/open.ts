import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors, openUrl } from "../../../ui/prompt"
import { createClient, location, request } from "../auth/shared"

export default Runtime.handler(Commands.commands.console.commands.open, (input) =>
  Effect.gen(function* () {
    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    const result = yield* request((signal) => client.integration.console.organizations({ location }, { signal }))
    const account = result.data.find((item) => item.active)
    if (!account) return yield* Effect.fail(new Error("No active Console account"))
    process.stdout.write(account.server + "\n")
    yield* openUrl(account.server)
  }).pipe(handlePromptErrors),
)
