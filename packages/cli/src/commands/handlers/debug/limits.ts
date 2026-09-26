import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { defaultFileStore } from "@opencode/core/model-limit.node"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(
  Commands.commands.debug.commands.limits,
  Effect.fn("cli.debug.limits")(function* (input) {
    const limits = yield* defaultFileStore()
    const forget = Option.getOrUndefined(input.forget)
    if (forget) {
      const slash = forget.indexOf("/")
      if (slash < 1 || slash === forget.length - 1)
        return yield* Effect.fail(new Error("Name the model as <provider>/<model>"))
      yield* limits.forget(forget.slice(0, slash), forget.slice(slash + 1))
      process.stdout.write(`Forgot ${forget}; the catalog limit applies again.${EOL}`)
      return
    }
    const entries = yield* limits.list()
    if (input.json) {
      process.stdout.write(JSON.stringify(entries, null, 2) + EOL)
      return
    }
    if (!entries.length) {
      process.stdout.write(`No input limits learned from providers.${EOL}`)
      return
    }
    entries.forEach((entry) => {
      const observed = entry.observed
      const kind = observed.includesOutput ? "input and output tokens" : "input tokens"
      process.stdout.write(`${entry.providerID}/${entry.modelID}: ${observed.limit.toLocaleString("en-US")} ${kind}${EOL}`)
      process.stdout.write(`  learned ${new Date(observed.at).toISOString()}${observed.ratio ? `, estimate ratio ${observed.ratio.toFixed(2)}` : ""}${EOL}`)
      process.stdout.write(`  ${observed.message.split("\n")[0]}${EOL}`)
    })
  }),
)
