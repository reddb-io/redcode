import { EOL } from "node:os"
import { password } from "@clack/prompts"
import { Effect, Option, Schema } from "effect"
import { Vault } from "@opencode/schema/vault"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors, prompt } from "../../../ui/prompt"
import { readStdin } from "../../../util/io"
import { callVault, pipedValue } from "./shared"

export default Runtime.handler(
  Commands.commands.vault.commands.set,
  Effect.fn("cli.vault.set")(function* (input) {
    // A piped value is read to EOF; a terminal gets a masked prompt so the value never shows on screen.
    const value = process.stdin.isTTY
      ? yield* prompt<string>(() =>
          password({
            message: `Value for ${input.name}`,
            validate: (entry) => (!entry ? "Required" : undefined),
          }),
        )
      : pipedValue(yield* Effect.tryPromise({ try: () => readStdin(), catch: (cause) => cause }))
    if (!value) return yield* Effect.fail(new Error("Refusing to store an empty secret"))
    const stored = yield* callVault({
      server: Option.getOrUndefined(input.server),
      method: "set",
      input: { name: input.name, value },
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.String)))
    process.stdout.write(`Stored ${Vault.reference(stored)}` + EOL)
  }, handlePromptErrors),
)
