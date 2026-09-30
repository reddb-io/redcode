import { EOL } from "node:os"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"
import { stopLossLines, stopLossReport } from "./stop-loss-report"

const DAY_MS = 86_400_000
// The stop-loss report is worked out from the trips themselves, so it reads more of them than the listing shows.
const REPORT_LIMIT = 1000

export default Runtime.handler(
  Commands.commands.debug.commands.guards,
  Effect.fn("cli.debug.guards")(function* (input) {
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const report = yield* Effect.promise(() =>
      client.debug.guards({
        since: Math.max(0, Date.now() - input.days * DAY_MS),
        limit: Math.max(input.limit, REPORT_LIMIT),
      }),
    )
    if (input.json) {
      process.stdout.write(
        JSON.stringify(
          { ...report, recent: report.recent.slice(0, input.limit), stopLoss: stopLossReport(report.recent) },
          null,
          2,
        ) + EOL,
      )
      return
    }
    if (!report.summary.length) {
      process.stdout.write(`No guard interventions recorded in the last ${input.days} day(s).${EOL}`)
      return
    }
    const width = Math.max(...report.summary.map((row) => row.guard.length))
    process.stdout.write(`Guards in the last ${input.days} day(s):${EOL}`)
    report.summary.forEach((row) =>
      process.stdout.write(`  ${row.guard.padEnd(width)}  ${row.action.padEnd(7)}  ${row.count}${EOL}`),
    )
    const stopLoss = stopLossLines(stopLossReport(report.recent))
    if (stopLoss.length) process.stdout.write(`${EOL}${stopLoss.join(EOL)}${EOL}`)
    if (!report.recent.length) return
    process.stdout.write(`${EOL}Most recent:${EOL}`)
    report.recent.slice(0, input.limit).forEach((entry) => {
      const when = new Date(entry.at).toISOString().replace("T", " ").slice(0, 19)
      process.stdout.write(`  ${when}  ${entry.guard}/${entry.action}${entry.subject ? ` ${entry.subject}` : ""}${EOL}`)
      process.stdout.write(`    ${entry.detail.split("\n")[0]}${EOL}`)
    })
  }),
)
