import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors } from "../../../ui/prompt"
import { createClient, location, request } from "../auth/shared"

export default Runtime.handler(Commands.commands.console.commands.orgs, (input) =>
  Effect.gen(function* () {
    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    const result = yield* request((signal) => client.integration.console.organizations({ location }, { signal }))
    if (result.data.length === 0) {
      process.stdout.write("No Console accounts found" + EOL)
      return
    }
    const rows = result.data.flatMap((account) =>
      account.orgs.map((org) =>
        `${account.active && org.id === account.activeID ? "*" : " "} ${org.name}  ${account.email}  ${account.server}  ${org.id}  ${account.credentialID}`,
      ),
    )
    if (rows.length === 0) {
      process.stdout.write("No Console organizations found" + EOL)
      return
    }
    process.stdout.write(rows.join(EOL) + EOL)
  }).pipe(handlePromptErrors),
)
