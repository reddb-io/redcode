import { EOL } from "node:os"
import path from "node:path"
import { Effect, Option, Schema } from "effect"
import { Vault } from "@opencode/schema/vault"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { callVault, importSummary } from "./shared"

export default Runtime.handler(
  Commands.commands.vault.commands.import,
  Effect.fn("cli.vault.import")(function* (input) {
    // The server reads the file, so its values never pass through this process or come back in the response.
    const imported = yield* callVault({
      server: Option.getOrUndefined(input.server),
      method: "import",
      input: { path: path.resolve(input.file) },
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Vault.Imported)))
    process.stdout.write(importSummary(imported).join(EOL) + EOL)
  }),
)
