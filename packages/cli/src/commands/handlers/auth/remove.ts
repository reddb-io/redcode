import { confirm, intro, log, outro, select } from "@clack/prompts"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors, prompt, requireInteractive } from "../../../ui/prompt"
import { createClient, location, request } from "./shared"

export default Runtime.handler(Commands.commands.auth.commands.remove, (input) =>
  Effect.gen(function* () {
    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    const target = Option.getOrUndefined(input.target)
    const interactive = process.stdin.isTTY && process.stdout.isTTY
    if (!target) yield* requireInteractive("Pass a provider ID in a non-interactive terminal")
    if (interactive) intro("Remove provider")
    const integrations = (yield* request((signal) => client.integration.list({ location }, { signal }))).data
    const configured = target
      ? []
      : (yield* request((signal) => client.config.get({ location }, { signal })))
          .filter((entry) => entry.type === "document")
          .flatMap((entry) => Object.keys(entry.info.providers ?? {}))
    const choices = [...new Set([
      ...integrations.filter((item) => item.connections.length > 0).map((item) => item.id),
      ...configured,
    ])]
    if (!target && choices.length === 0) return yield* Effect.fail(new Error("No saved or configured providers"))
    const providerID = target
      ? integrations.find((item) => item.id === target || item.name.toLowerCase() === target.toLowerCase())?.id ?? target
      : yield* prompt<string>(() => select({
          message: "Provider",
          options: choices.map((id) => ({ value: id, label: integrations.find((item) => item.id === id)?.name ?? id })),
        }))
    const preview = (yield* request((signal) =>
      client.provider.remove({ providerID, dryRun: true, location }, { signal }),
    )).data
    const lines = [
      `${preview.removed.credentials} saved credential(s)`,
      ...(preview.removed.config ? ["Global provider configuration"] : []),
      ...preview.removed.references.map((reference) => `Reference: ${reference}`),
      ...(preview.removed.learnedLimits ? [`${preview.removed.learnedLimits} learned model limit(s)`] : []),
      ...(preview.removed.hidden ? ["Ambient provider will be hidden by policy"] : []),
      ...preview.referencingFiles.map((file) => `Other configuration still references this provider: ${file}`),
    ]
    if (!preview.removed.credentials && !preview.removed.config && !preview.removed.references.length &&
        !preview.removed.learnedLimits && !preview.removed.hidden)
      return yield* Effect.fail(new Error(`Nothing to remove for ${providerID}`))
    if (interactive) lines.forEach((line) => log.info(line))
    if (!interactive) process.stdout.write(lines.join(EOL) + EOL)
    if (!input.yes) {
      yield* requireInteractive("Pass --yes to remove a provider in a non-interactive terminal")
      const accepted = yield* prompt<boolean>(() => confirm({ message: `Remove ${providerID}?` }))
      if (!accepted) return
    }
    const result = (yield* request((signal) =>
      client.provider.remove({ providerID, dryRun: false, location }, { signal }),
    )).data
    if (interactive) outro(`Removed ${result.providerID}`)
    if (!interactive) process.stdout.write(`Removed ${result.providerID}${EOL}`)
  }).pipe(handlePromptErrors),
)
