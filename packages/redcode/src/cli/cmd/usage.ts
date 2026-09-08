import type { Argv } from "yargs"
import { Effect } from "effect"
import { Usage } from "@reddb-io/redcode-core/usage/usage"
import { UsageBackfill } from "@reddb-io/redcode-core/usage/backfill"
import { effectCmd, fail } from "../effect-cmd"

const BackfillCommand = effectCmd({
  command: "backfill",
  describe: "mirror the usage already in the session stores, so reports cover history too",
  instance: false,
  builder: (yargs: Argv) => yargs.option("json", { type: "boolean", describe: "print the result as JSON" }),
  handler: Effect.fn("Cli.usage.backfill")(function* (args: { json?: boolean }) {
    if (!Usage.enabled()) return yield* fail("the usage mirrors are disabled (REDCODE_DISABLE_USAGE_SIDECAR)")
    const result = UsageBackfill.run({
      onStore: args.json ? undefined : (file: string, rows: number) => console.log(`${file}: ${rows} messages`),
    })
    const error = Usage.lastError()
    if (args.json) {
      console.log(JSON.stringify({ ...result, sidecar: Usage.path(), fanout: Usage.fanoutPath() ?? null }, null, 2))
    } else {
      console.log(`mirrored ${result.mirrored}, skipped ${result.skipped} (user messages and turns with no usage)`)
      console.log(`sidecar: ${Usage.path()}`)
      console.log(`fan-out: ${Usage.fanoutPath() ?? "none (no OpenCode database on this machine)"}`)
    }
    // A mirror that gave up mid-run leaves a partial result; say so rather than reporting a clean finish.
    if (error) return yield* fail(`a usage mirror failed during the backfill: ${String(error)}`)
  }),
})

const PathCommand = effectCmd({
  command: "path",
  describe: "print where the usage mirrors are written",
  instance: false,
  handler: Effect.fn("Cli.usage.path")(function* () {
    console.log(Usage.path())
    const fanout = Usage.fanoutPath()
    if (fanout) console.log(fanout)
  }),
})

export const UsageCommand = effectCmd({
  command: "usage",
  describe: "token usage mirrors",
  instance: false,
  builder: (yargs: Argv) => yargs.command(BackfillCommand).command(PathCommand).demandCommand(),
  handler: Effect.fn("Cli.usage")(function* () {}),
})
