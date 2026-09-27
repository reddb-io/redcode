import { EOL } from "node:os"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

const clip = (value: string) => {
  const line = value.replaceAll(/\s+/g, " ").trim()
  return line.length > 200 ? `${line.slice(0, 199)}…` : line
}

export default Runtime.handler(
  Commands.commands.debug.commands.todos,
  Effect.fn("cli.debug.todos")(function* (input) {
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const sessionID = Option.getOrUndefined(input.sessionID) ??
      (yield* Effect.promise(() => client.session.list({ directory: process.cwd(), order: "desc", limit: 1 }))).data[0]?.id
    if (!sessionID) return yield* Effect.fail(new Error(`No session found in ${process.cwd()}`))
    const report = yield* Effect.promise(() => client.debug.todos({ sessionID }))
    if (input.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + EOL)
      return
    }
    const lines = [`session ${report.sessionID}`, "", `tasks (${report.tasks.length})`]
    if (!report.tasks.length) lines.push("  none")
    report.tasks.forEach((task) => {
      lines.push(`  ${task.id} r${task.revision ?? "?"} [${task.status}] (${task.priority}) ${clip(task.content)}`)
      lines.push(task.source
        ? `    source: ${task.source.type} ${task.source.messageID}, ${task.source.paraphrase ? `paraphrase "${clip(task.source.paraphrase)}"` : `quote "${clip(task.source.quote)}"`}`
        : "    source: none")
      lines.push(`    criterion: ${task.criterion ? clip(task.criterion) : "none"}`)
      lines.push(`    evidence: ${task.evidence ? clip(task.evidence) : "none"}`)
      if (task.reason) lines.push(`    reason: ${clip(task.reason)}`)
      if (task.scopeChange) lines.push(`    scope change: ${task.scopeChange.messageID}, ${task.scopeChange.paraphrase ? `paraphrase "${clip(task.scopeChange.paraphrase)}"` : `quote "${clip(task.scopeChange.quote)}"`}`)
      lines.push(`    refused attempts: ${task.refusals}`)
    })
    lines.push("", `todowrite errors (latest ${report.errors.length}, max 20)`)
    if (!report.errors.length) lines.push("  none")
    report.errors.forEach((error) => lines.push(`  ${error.time} ${error.kind} ${error.callID}: ${clip(error.message)}`))
    process.stdout.write(lines.join(EOL) + EOL)
  }),
)
