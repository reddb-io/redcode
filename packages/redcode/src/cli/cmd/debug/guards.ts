import { Effect } from "effect"
import { SessionGuardLog } from "@/session/guard-log"
import { effectCmd } from "../../effect-cmd"

const DAY_MS = 86_400_000

/**
 * What the turn's guards actually did.
 *
 * Every threshold in them was argued into place — ten minutes for a tool, three identical calls
 * for a loop, two steps of grace before the wall. This is the command that turns the next argument
 * into a reading: how often each one fired, on what, and whether it was right.
 */
export const GuardsCommand = effectCmd({
  command: "guards",
  describe: "how often the turn guards intervened, and on what",
  builder: (yargs) =>
    yargs
      .option("days", { type: "number", default: 7, description: "how far back to look" })
      .option("limit", { type: "number", default: 20, description: "how many recent trips to print" }),
  handler: Effect.fn("Cli.debug.guards")(function* (args) {
    const since = Date.now() - Math.max(0, args.days) * DAY_MS
    const summary = yield* SessionGuardLog.Service.use((svc) => svc.summary({ since }))
    const recent = yield* SessionGuardLog.Service.use((svc) => svc.recent({ since, limit: args.limit }))

    if (summary.length === 0) {
      console.log(`No guard fired in the last ${args.days} day(s).`)
      // Said plainly: an empty table reads as "no data collected", which is a different thing.
      console.log("That means every turn finished on its own, or this build has not run since they landed.")
      return
    }

    console.log(`Guards that fired in the last ${args.days} day(s):\n`)
    const width = Math.max(...summary.map((row) => row.guard.length))
    for (const row of summary) {
      console.log(`  ${row.guard.padEnd(width)}  ${row.action.padEnd(7)}  ${row.count}`)
    }

    if (recent.length === 0) return
    console.log(`\nMost recent:\n`)
    for (const entry of recent) {
      const when = new Date(entry.at).toISOString().replace("T", " ").slice(0, 19)
      const subject = entry.subject ? ` ${entry.subject}` : ""
      console.log(`  ${when}  ${entry.guard}/${entry.action}${subject}`)
      console.log(`    ${entry.detail.split("\n")[0]}`)
    }
  }),
})
