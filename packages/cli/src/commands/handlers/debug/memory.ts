import { EOL } from "node:os"
import { stat } from "node:fs/promises"
import { getHeapStatistics } from "node:v8"
import { sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { Global } from "@opencode/util/global"
import { Database } from "@opencode/core/database/database"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { select } from "../../../database-selection"
import { ServiceConfig } from "../../../services/service-config"

const Registration = Schema.fromJsonString(Schema.Struct({ pid: Schema.Int }))

// Where memory goes: this process's heap, the background service's resident size (read from the
// OS, so nothing is signalled), and the stored data every session read pays for.
export default Runtime.handler(
  Commands.commands.debug.commands.memory,
  Effect.fn("cli.debug.memory")(function* (input) {
    const global = yield* Global.Service
    const selected = yield* Effect.promise(() => select(global))
    const sessions = yield* Effect.gen(function* () {
      const database = yield* Database.Service
      const [row] = yield* database.db.all<{
        total: number
        subagents: number
        archived: number
        claimed: number
      }>(
        sql`SELECT count(*) AS total, count(parent_id) AS subagents, count(time_archived) AS archived, count(time_suspended) AS claimed FROM session_v2`,
      )
      const [messages] = yield* database.db.all<{ total: number }>(sql`SELECT count(*) AS total FROM session_message`)
      return { ...row, messages: messages?.total ?? 0 }
    }).pipe(Effect.provide(Database.layer(selected)))
    const registration = (yield* ServiceConfig.options()).file
    const service = yield* Effect.promise(async () => {
      const text = await Bun.file(registration)
        .text()
        .catch(() => undefined)
      const pid =
        text === undefined ? undefined : Option.getOrUndefined(Schema.decodeUnknownOption(Registration)(text))?.pid
      return pid === undefined ? undefined : { pid, ...(await processMemory(pid)) }
    })
    const database = yield* Effect.promise(async () => {
      if (!selected.path || selected.path === ":memory:") return { location: selected.url ?? selected.path }
      const size = async (file: string) => (await stat(file).catch(() => undefined))?.size ?? 0
      return { location: selected.path, bytes: await size(selected.path), walBytes: await size(`${selected.path}-wal`) }
    })
    const usage = process.memoryUsage()
    const report = {
      process: {
        pid: process.pid,
        rss: usage.rss,
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        heapLimit: getHeapStatistics().heap_size_limit,
        external: usage.external,
        arrayBuffers: usage.arrayBuffers,
      },
      service,
      database,
      sessions,
    }
    if (input.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + EOL)
      return
    }
    const lines = [
      `This process (pid ${report.process.pid})`,
      `  rss         ${bytes(report.process.rss)}`,
      `  heap        ${bytes(report.process.heapUsed)} used of ${bytes(report.process.heapTotal)} (limit ${bytes(report.process.heapLimit)})`,
      `  external    ${bytes(report.process.external)} (array buffers ${bytes(report.process.arrayBuffers)})`,
      service
        ? `Background service (pid ${service.pid})${EOL}  rss         ${service.rss === undefined ? "unavailable on this platform" : bytes(service.rss)}${service.swap ? `${EOL}  swap        ${bytes(service.swap)}` : ""}`
        : "Background service not running",
      `Database ${database.location ?? "unknown"}`,
      ...(database.bytes !== undefined
        ? [`  size        ${bytes(database.bytes)} (+ ${bytes(database.walBytes ?? 0)} WAL)`]
        : []),
      `Sessions`,
      `  total       ${sessions.total ?? 0} (${sessions.subagents ?? 0} subagents, ${sessions.archived ?? 0} archived, ${sessions.claimed ?? 0} claimed by an execution)`,
      `  messages    ${sessions.messages}`,
    ]
    process.stdout.write(lines.join(EOL) + EOL)
  }),
)

/** Resident and swapped memory of another process, from /proc on Linux; other platforms report nothing. */
async function processMemory(pid: number) {
  const status = await Bun.file(`/proc/${pid}/status`)
    .text()
    .catch(() => undefined)
  if (status === undefined) return { rss: undefined, swap: undefined }
  const kilobytes = (name: string) => {
    const match = status.match(new RegExp(`^${name}:\\s+(\\d+) kB`, "m"))
    return match ? Number(match[1]) * 1024 : undefined
  }
  return { rss: kilobytes("VmRSS"), swap: kilobytes("VmSwap") }
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`
  const units = ["KiB", "MiB", "GiB"]
  const exponent = Math.min(units.length, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** exponent).toFixed(1)} ${units[exponent - 1]}`
}
