import { autocomplete, intro, outro, spinner } from "@clack/prompts"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors, prompt, requireInteractive } from "../../../ui/prompt"
import { createClient, location, request } from "../auth/shared"

export default Runtime.handler(Commands.commands.console.commands.switch, (input) =>
  Effect.gen(function* () {
    const target = Option.getOrUndefined(input.org)
    const accountID = Option.getOrUndefined(input.account)
    intro("Switch Console organization")
    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    const result = yield* request((signal) => client.integration.console.organizations({ location }, { signal }))
    const choices = result.data
      .filter((account) => !accountID || account.credentialID === accountID)
      .flatMap((account) =>
        account.orgs
          .filter((org) => !target || org.id === target)
          .map((org) => ({ account, org })),
      )
    if (choices.length === 0)
      return yield* Effect.fail(new Error(target ? `Console organization not found: ${target}` : "No Console organizations found"))
    if (choices.length > 1) yield* requireInteractive("Pass --account with the Console credential ID to disambiguate")
    if (!target) yield* requireInteractive("Pass an organization ID when running without an interactive terminal")
    const selected =
      choices.length === 1
        ? choices[0]
        : choices[
            Number(
              yield* prompt<string>(() =>
                autocomplete({
                  message: "Select organization",
                  maxItems: 8,
                  options: choices.map((choice, index) => ({
                    value: String(index),
                    label: `${choice.org.name} (${choice.account.email})`,
                    hint: choice.account.active && choice.org.id === choice.account.activeID ? "active" : choice.org.id,
                  })),
                }),
              ),
            )
          ]
    if (!selected) return yield* Effect.fail(new Error("Console organization selection is unavailable"))
    const progress = spinner()
    progress.start("Switching organization...")
    yield* request((signal) =>
      client.integration.console.organization.select(
        { location, credentialID: selected.account.credentialID, orgID: selected.org.id },
        { signal },
      ),
    ).pipe(
      Effect.tap(() => Effect.sync(() => progress.stop(`Switched to ${selected.org.name}`))),
      Effect.tapCause(() => Effect.sync(() => progress.stop("Failed to switch organization", 1))),
    )
    outro("Done")
  }).pipe(handlePromptErrors),
)
