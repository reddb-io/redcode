import { autocomplete, intro, outro, spinner } from "@clack/prompts"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors, prompt, requireInteractive } from "../../../ui/prompt"
import { createClient, location, request } from "../auth/shared"

export default Runtime.handler(Commands.commands.console.commands.switch, (input) =>
  Effect.gen(function* () {
    const target = Option.getOrUndefined(input.org)
    if (!target) yield* requireInteractive("Pass an organization ID when running without an interactive terminal")
    intro("Switch Console organization")
    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    const result = yield* request((signal) => client.integration.console.organizations({ location }, { signal }))
    const account = result.data
    if (account.orgs.length === 0) return yield* Effect.fail(new Error("No Console organizations found"))
    const orgID =
      target ??
      (yield* prompt<string>(() =>
        autocomplete({
          message: "Select organization",
          maxItems: 8,
          options: account.orgs.map((item) => ({
            value: item.id,
            label: item.name,
            hint: item.id === account.activeID ? "active" : item.id,
          })),
        }),
      ))
    const selected = account.orgs.find((org) => org.id === orgID)
    if (!selected) return yield* Effect.fail(new Error(`Console organization not found: ${orgID}`))
    const progress = spinner()
    progress.start("Switching organization...")
    yield* request((signal) =>
      client.integration.console.organization.select({ location, orgID: selected.id }, { signal }),
    ).pipe(
      Effect.tap(() => Effect.sync(() => progress.stop(`Switched to ${selected.name}`))),
      Effect.tapCause(() => Effect.sync(() => progress.stop("Failed to switch organization", 1))),
    )
    outro("Done")
  }).pipe(handlePromptErrors),
)
