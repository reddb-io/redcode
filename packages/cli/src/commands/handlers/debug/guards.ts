import { EOL } from "node:os"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

const DAY_MS = 86_400_000

export default Runtime.handler(
  Commands.commands.debug.commands.guards,
  Effect.fn("cli.debug.guards")(function* (input) {
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const report = (yield* Effect.promise(() =>
      client.debug.guards({ since: Math.max(0, Date.now() - input.days * DAY_MS), limit: input.limit }),
    ))
    if (input.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + EOL)
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
    if (!report.recent.length) return
    process.stdout.write(`${EOL}Most recent:${EOL}`)
    report.recent.forEach((entry) => {
      const when = new Date(entry.at).toISOString().replace("T", " ").slice(0, 19)
      process.stdout.write(`  ${when}  ${entry.guard}/${entry.action}${entry.subject ? ` ${entry.subject}` : ""}${EOL}`)
      process.stdout.write(`    ${entry.detail.split("\n")[0]}${EOL}`)
    })
  }),
)
