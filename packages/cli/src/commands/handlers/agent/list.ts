import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors } from "../../../ui/prompt"
import { createClient, location, request } from "../auth/shared"

export default Runtime.handler(Commands.commands.agent.commands.list, (input) =>
  Effect.gen(function* () {
    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    const agents = (yield* request((signal) => client.agent.list({ location }, { signal }))).data
    process.stdout.write(
      agents
        .map((agent) => `${agent.id} (${agent.mode})${agent.description ? `${EOL}  ${agent.description}` : ""}`)
        .join(EOL) + EOL,
    )
  }).pipe(handlePromptErrors),
)
