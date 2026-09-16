import { Effect } from "effect"
import { ModelLimit } from "@reddb-io/redcode-core/model-limit"
import { effectCmd } from "../../effect-cmd"

/**
 * The input limits providers taught us.
 *
 * A router or a corporate proxy often enforces less than the catalog's context, and a request
 * refused for its size says how much. Those lessons live here, per provider and model, and every
 * request is sized by the smaller of the catalog's limit and the provider's. `--forget` drops one
 * so the catalog's limit applies again.
 */
export const LimitsCommand = effectCmd({
  command: "limits",
  describe: "input limits learned from providers, and the estimate calibration that came with them",
  // Global state: no project instance is needed to read or drop a lesson.
  instance: false,
  builder: (yargs) =>
    yargs
      .option("json", { type: "boolean", default: false, description: "print as JSON" })
      .option("forget", { type: "string", description: "drop the lesson for <provider>/<model>" }),
  handler: Effect.fn("Cli.debug.limits")(function* (args) {
    const limits = yield* ModelLimit.Service
    if (args.forget) {
      const slash = args.forget.indexOf("/")
      if (slash <= 0) {
        console.log("Name the model as <provider>/<model>.")
        return
      }
      yield* limits.forget(args.forget.slice(0, slash), args.forget.slice(slash + 1))
      console.log(`Forgot ${args.forget}; the catalog's limit applies again.`)
      return
    }
    const entries = yield* limits.list()
    if (args.json) {
      console.log(JSON.stringify(entries, null, 2))
      return
    }
    if (entries.length === 0) {
      console.log("No provider has refused a request for its size yet, so every model is sized by the catalog's limit.")
      return
    }
    console.log("Input limits learned from providers (the smaller of these and the catalog's limit applies):\n")
    for (const entry of entries) {
      const { observed } = entry
      const when = new Date(observed.at).toISOString().replace("T", " ").slice(0, 19)
      const counted = observed.counted === undefined ? "" : `, counted ${observed.counted.toLocaleString("en-US")}`
      const estimated =
        observed.estimated === undefined ? "" : `, estimated ${observed.estimated.toLocaleString("en-US")}`
      const ratio = observed.ratio === undefined ? "" : `, estimates scaled by ${observed.ratio.toFixed(2)}`
      const declared = observed.declared
        ? ` (config declared context ${observed.declared.context ?? "-"}${observed.declared.input === undefined ? "" : `, input ${observed.declared.input}`})`
        : ""
      const kind = observed.includesOutput ? "input and output tokens together" : "input tokens"
      console.log(`  ${entry.providerID}/${entry.modelID}`)
      console.log(`    accepts ${observed.limit.toLocaleString("en-US")} ${kind}${counted}${estimated}${ratio}`)
      console.log(`    learned ${when}${declared}`)
      console.log(`    ${observed.message.split("\n")[0]}`)
    }
  }),
})
