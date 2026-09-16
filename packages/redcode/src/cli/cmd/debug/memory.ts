import fs from "fs/promises"
import path from "path"
import { MemoryReport } from "@reddb-io/redcode-core/observability/memory"
import { cmd } from "../cmd"

/**
 * Memory of running redcode processes.
 *
 * Every redcode process of this user is listed with its resident memory from /proc. A process that
 * listens for memory requests (a TUI or `redcode serve` from this version on) also reports the
 * JavaScript heap of each of its threads and the size of its caches: it is sent SIGUSR1 and writes
 * the report to a file this command reads back. A process is signalled only when its listener
 * marker matches it, on every platform, so older processes are never signalled.
 */
export const MemoryCommand = cmd({
  command: "memory [pid]",
  describe: "show the memory of running redcode processes: resident, heap per thread, caches",
  builder: (yargs) =>
    yargs
      .positional("pid", { type: "number", describe: "only this process" })
      .option("json", { type: "boolean", default: false, describe: "print as JSON" })
      .option("timeout", { type: "number", default: 5000, describe: "milliseconds to wait for each report" }),
  async handler(args) {
    if (process.platform === "win32") {
      console.log("Memory reports need signals, which Windows does not have.")
      return
    }
    if (process.platform !== "linux" && args.pid === undefined) {
      console.log(
        "Listing processes needs /proc (Linux). Pass the pid of a running redcode to ask it for a report, for example `redcode debug memory 12345`.",
      )
      return
    }
    const pids = args.pid === undefined ? await redcodeProcesses() : [args.pid]
    const reports = await Promise.all(pids.map((pid) => requestReport(pid, args.timeout)))
    if (args.json) {
      console.log(JSON.stringify(reports, null, 2))
      return
    }
    if (reports.length === 0) {
      console.log("No other redcode process is running.")
      return
    }
    for (const entry of reports) {
      console.log(entry.command)
      if (entry.report) console.log(MemoryReport.format(entry.report))
      if (!entry.report && entry.process)
        console.log(MemoryReport.format({ pid: entry.pid, uptime: 0, process: entry.process, threads: [], caches: [] }))
      if (entry.note) console.log(`  ${entry.note}`)
      console.log("")
    }
    const total = reports.reduce((sum, entry) => sum + (entry.report?.process?.pss ?? entry.process?.pss ?? 0), 0)
    if (reports.length > 1 && total > 0)
      console.log(`total pss ${MemoryReport.bytes(total)} across ${reports.length} processes`)
  },
})

/** Asks one process for its report: /proc figures for any process, heap and caches when it listens. */
export async function requestReport(pid: number, timeout: number) {
  const command = await fs.readFile(`/proc/${pid}/cmdline`, "utf8").then(
    (raw) => raw.split("\0").filter(Boolean).join(" "),
    () => `pid ${pid}`,
  )
  const stats = await MemoryReport.processStats(pid)
  if (process.platform === "linux" && !stats) return { pid, command, note: "not running" }
  // `request` refuses, without signalling, any process whose listener marker does not match it.
  const answer = await MemoryReport.request(pid, timeout)
  if (answer.report) return { pid, command, report: answer.report }
  return { pid, command, process: stats, note: answer.refused }
}

/** Processes of this user whose executable or entry script is redcode, this one excluded. */
async function redcodeProcesses() {
  const entries = await fs.readdir("/proc").catch(() => [] as string[])
  const uid = process.getuid?.()
  const found = await Promise.all(
    entries
      .filter((entry) => /^\d+$/.test(entry) && Number(entry) !== process.pid)
      .map(async (entry) => {
        const pid = Number(entry)
        const [cmdline, stat] = await Promise.all([
          fs.readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => ""),
          fs.stat(`/proc/${pid}`).catch(() => undefined),
        ])
        if (!stat || (uid !== undefined && stat.uid !== uid)) return []
        return isRedcode(cmdline.split("\0").filter(Boolean)) ? [pid] : []
      }),
  )
  return found.flat().toSorted((a, b) => a - b)
}

export function isRedcode(argv: string[]) {
  const first = argv[0]
  if (!first) return false
  if (path.basename(first) === "redcode") return true
  // A development checkout: `bun run --cwd packages/redcode src/index.ts`, or the entry spelled out.
  return (
    path.basename(first) === "bun" &&
    argv.some((arg) => /(^|[\\/])packages[\\/]redcode([\\/]src[\\/]index\.ts)?$/.test(arg))
  )
}
