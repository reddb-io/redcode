// Memory report for a running process: resident memory from the operating system, the JavaScript
// heap of each thread, and the size of the caches that registered themselves with `track`.
//
// A TUI process runs two JavaScript heaps — the screen on the main thread and the server in a
// worker — and each thread has its own copy of this module, so each thread reports its own heap
// and its own caches. The main thread asks the worker for its half and writes one report.
//
// A running process is reached with a signal: `listen` installs a SIGUSR1 handler and a marker file
// with the process's start time, and `request` signals only a process whose marker matches (and, on
// Linux, whose handler /proc lists), because SIGUSR1's default action terminates a process that
// never installed one — an older redcode included. Windows has no signals: no reports there.
import { spawnSync } from "child_process"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import fs from "fs/promises"
import path from "path"
import { Global } from "../global"

export interface Thread {
  readonly name: string
  /** Bytes held by live JavaScript objects. */
  readonly heapSize: number
  /** Bytes the garbage collector has reserved for the heap. */
  readonly heapCapacity: number
  /** Bytes outside the heap owned by JavaScript objects (buffers, strings backed by native memory). */
  readonly extraMemory: number
  readonly objectCount: number
  /** Object types with the most live instances. */
  readonly topTypes: ReadonlyArray<{ readonly type: string; readonly count: number }>
}

export interface Cache {
  readonly name: string
  readonly entries: number
  readonly bytes?: number
}

export interface Child {
  readonly pid: number
  readonly command: string
  readonly rss: number
}

export interface ProcessStats {
  readonly pid: number
  readonly rss: number
  readonly pss?: number
  readonly anonymous?: number
  readonly swap?: number
  readonly peak?: number
  readonly threads?: number
  readonly children: ReadonlyArray<Child>
}

export interface Report {
  readonly pid: number
  readonly uptime: number
  readonly process?: ProcessStats
  readonly threads: ReadonlyArray<Thread>
  readonly caches: ReadonlyArray<Cache>
}

const caches = new Map<string, () => Omit<Cache, "name">>()

/** Registers a cache whose size a memory report lists. Returns the function that removes it. */
export function track(name: string, size: () => Omit<Cache, "name">) {
  caches.set(name, size)
  return () => {
    if (caches.get(name) === size) caches.delete(name)
  }
}

export function cacheSizes(): Cache[] {
  return [...caches].flatMap(([name, size]) => {
    try {
      return [{ name, ...size() }]
    } catch {
      return []
    }
  })
}

export async function thread(name: string, top = 8): Promise<Thread> {
  const usage = process.memoryUsage()
  if (!process.versions.bun)
    return {
      name,
      heapSize: usage.heapUsed,
      heapCapacity: usage.heapTotal,
      extraMemory: usage.external,
      objectCount: 0,
      topTypes: [],
    }
  const { heapStats } = await import("bun:jsc")
  const stats = heapStats()
  return {
    name,
    heapSize: stats.heapSize,
    heapCapacity: stats.heapCapacity,
    extraMemory: stats.extraMemorySize,
    objectCount: stats.objectCount,
    topTypes: Object.entries(stats.objectTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([type, count]) => ({ type, count })),
  }
}

/** Resident memory of a process and its direct children, from /proc. Undefined where there is no /proc. */
export async function processStats(pid = process.pid): Promise<ProcessStats | undefined> {
  const status = await readStatus(pid)
  if (!status) return undefined
  const rollup = await fs.readFile(`/proc/${pid}/smaps_rollup`, "utf8").then(fields, () => undefined)
  const children = await Promise.all(
    (await childPids(pid)).map(async (child) => {
      const [info, cmdline] = await Promise.all([
        readStatus(child),
        fs.readFile(`/proc/${child}/cmdline`, "utf8").catch(() => ""),
      ])
      return info ? [{ pid: child, command: commandLine(cmdline) || info.Name || "", rss: kb(info.VmRSS) }] : []
    }),
  )
  return {
    pid,
    rss: kb(status.VmRSS),
    pss: rollup ? kb(rollup.Pss) : undefined,
    anonymous: rollup ? kb(rollup.Anonymous) : kb(status.RssAnon),
    swap: kb(status.VmSwap),
    peak: kb(status.VmHWM),
    threads: Number(status.Threads) || undefined,
    children: children.flat(),
  }
}

/** Collects this process's report: the calling thread first, then any threads `others` adds. */
export async function collect(input: { name: string; others?: () => Promise<{ threads: Thread[]; caches: Cache[] }> }) {
  const [self, others, stats] = await Promise.all([
    thread(input.name),
    input.others?.().catch(() => undefined),
    processStats(),
  ])
  return {
    pid: process.pid,
    uptime: Math.round(process.uptime()),
    process: stats,
    threads: [self, ...(others?.threads ?? [])],
    caches: [
      ...cacheSizes().map((cache) => ({ ...cache, name: `${input.name}: ${cache.name}` })),
      ...(others?.caches ?? []),
    ],
  } satisfies Report
}

/** Directory of listener markers, report requests and reports. */
export function directory() {
  return path.join(Global.Path.state, "memory")
}

function markerPath(pid: number) {
  return path.join(directory(), `${pid}.listening`)
}

let installed: (() => void) | undefined

/**
 * Answers SIGUSR1 with a report. Each pending request file `<pid>.<nonce>.request` gets its own
 * `<pid>.<nonce>.json`, so concurrent readers never take each other's report; a signal with no
 * request pending (another reader's request already answered) writes nothing. While listening, the marker `<pid>.listening` records this
 * process's start time: a reader signals only a process whose marker matches it.
 */
export function listen(input: Parameters<typeof collect>[0]) {
  if (process.platform === "win32") return () => {}
  installed?.()
  const pid = process.pid
  const handler = () => {
    void answer(input).catch(() => {})
  }
  const cleanup = () => {
    rmSync(markerPath(pid), { force: true })
  }
  mkdirSync(directory(), { recursive: true })
  writeFileSync(markerPath(pid), JSON.stringify({ pid, startedAt: startedAt() }), { mode: 0o600 })
  process.on("SIGUSR1", handler)
  process.on("exit", cleanup)
  installed = () => {
    process.off("SIGUSR1", handler)
    process.off("exit", cleanup)
    cleanup()
    installed = undefined
  }
  return installed
}

async function answer(input: Parameters<typeof collect>[0]) {
  const report = await collect(input)
  const prefix = `${report.pid}.`
  const nonces = (await fs.readdir(directory()).catch(() => [] as string[]))
    .filter((name) => name.startsWith(prefix) && name.endsWith(".request"))
    .map((name) => name.slice(prefix.length, -".request".length))
  await Promise.all(
    nonces.map(async (nonce) => {
      await fs.rm(path.join(directory(), `${prefix}${nonce}.request`), { force: true })
      await write(path.join(directory(), `${prefix}${nonce}.json`), report)
    }),
  )
}

// Owner-only, and renamed into place so a reader never sees half a report: child command lines
// in a report can carry tokens.
async function write(file: string, report: Report) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(report, null, 2), { mode: 0o600 })
  await fs.rename(temporary, file)
}

/**
 * Whether `pid` is a process listening for memory requests, so SIGUSR1 cannot terminate it: its
 * marker exists and records the start time the operating system reports for that pid (a stale
 * marker whose pid was reused does not match), and on Linux its SIGUSR1 handler is installed.
 */
export async function listening(pid: number) {
  if (process.platform === "win32") return false
  const marker = await fs
    .readFile(markerPath(pid), "utf8")
    .then(
      (text) => JSON.parse(text) as { pid?: unknown; startedAt?: unknown },
      () => undefined,
    )
    .catch(() => undefined)
  if (marker?.pid !== pid || typeof marker.startedAt !== "number") return false
  const started = await startTime(pid)
  if (started === undefined || Math.abs(started - marker.startedAt) > 2000) return false
  if (process.platform !== "linux") return true
  const status = await readStatus(pid)
  if (!status?.SigCgt) return false
  return (BigInt(`0x${status.SigCgt}`) & (1n << 9n)) !== 0n
}

/**
 * Asks a process for its report. Refuses, without signalling, any process that is not listening.
 * Removes the request and the report it created, and nothing else.
 */
export async function request(pid: number, timeout: number): Promise<{ report?: Report; refused?: string }> {
  if (process.platform === "win32") return { refused: "memory reports need signals, which Windows does not have" }
  if (!(await listening(pid)))
    return { refused: "does not answer memory requests (started before this version, or not a TUI or server)" }
  const nonce = crypto.randomUUID()
  const requestFile = path.join(directory(), `${pid}.${nonce}.request`)
  const reportFile = path.join(directory(), `${pid}.${nonce}.json`)
  await fs.writeFile(requestFile, "", { mode: 0o600 })
  try {
    process.kill(pid, "SIGUSR1")
  } catch (error) {
    await fs.rm(requestFile, { force: true })
    return { refused: `could not signal: ${error instanceof Error ? error.message : String(error)}` }
  }
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const text = await fs.readFile(reportFile, "utf8").catch(() => undefined)
    if (text !== undefined) {
      await fs.rm(reportFile, { force: true })
      return { report: JSON.parse(text) as Report }
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  await fs.rm(requestFile, { force: true })
  return { refused: `no report within ${timeout}ms` }
}

function startedAt() {
  return Date.now() - process.uptime() * 1000
}

/** When a process started, in milliseconds since the epoch, as the operating system reports it. */
async function startTime(pid: number) {
  if (process.platform === "linux") {
    const [stat, boot] = await Promise.all([
      fs.readFile(`/proc/${pid}/stat`, "utf8").catch(() => undefined),
      fs.readFile("/proc/stat", "utf8").catch(() => undefined),
    ])
    // Field 22, counted after the parenthesised command name (which may contain spaces).
    const ticks = Number(stat?.slice(stat.lastIndexOf(") ") + 2).split(" ")[19])
    const btime = Number(boot?.match(/^btime (\d+)$/m)?.[1])
    // Clock ticks are 1/100 s on every Linux redcode runs on.
    if (!Number.isFinite(ticks) || !Number.isFinite(btime)) return undefined
    return btime * 1000 + ticks * 10
  }
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    // In UTC, spelled out when parsing: the two sides of a local time can disagree on the zone.
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    encoding: "utf8",
  })
  const started = Date.parse(`${result.stdout?.trim() ?? ""} UTC`)
  return result.status === 0 && Number.isFinite(started) ? started : undefined
}

export function format(report: Report) {
  const lines = [`pid ${report.pid}  up ${duration(report.uptime)}`]
  const stats = report.process
  if (stats) {
    lines.push(
      `  process  rss ${bytes(stats.rss)}` +
        (stats.pss === undefined ? "" : `  pss ${bytes(stats.pss)}`) +
        (stats.anonymous === undefined ? "" : `  anon ${bytes(stats.anonymous)}`) +
        (stats.swap ? `  swap ${bytes(stats.swap)}` : "") +
        (stats.peak ? `  peak ${bytes(stats.peak)}` : "") +
        (stats.threads ? `  threads ${stats.threads}` : ""),
    )
    for (const child of stats.children)
      lines.push(
        `  child    ${String(child.pid).padEnd(8)} rss ${bytes(child.rss).padEnd(9)} ${child.command.slice(0, 80)}`,
      )
  }
  for (const item of report.threads) {
    lines.push(
      `  ${item.name.padEnd(8)} heap ${bytes(item.heapSize)} of ${bytes(item.heapCapacity)}  extra ${bytes(item.extraMemory)}  objects ${item.objectCount}`,
    )
    if (item.topTypes.length)
      lines.push(`           top: ${item.topTypes.map((entry) => `${entry.type} ${entry.count}`).join(", ")}`)
  }
  if (report.caches.length) lines.push("  caches")
  for (const cache of report.caches)
    lines.push(
      `    ${cache.name.padEnd(36)} ${String(cache.entries).padStart(7)} entries` +
        (cache.bytes === undefined ? "" : `  ${bytes(cache.bytes)}`),
    )
  return lines.join("\n")
}

export function bytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`
  return `${value} B`
}

function duration(seconds: number) {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m${seconds % 60}s`
  return `${seconds}s`
}

function fields(text: string) {
  return Object.fromEntries(
    text.split("\n").flatMap((line) => {
      const index = line.indexOf(":")
      return index > 0 ? [[line.slice(0, index), line.slice(index + 1).trim()]] : []
    }),
  ) as Record<string, string | undefined>
}

function readStatus(pid: number) {
  if (process.platform !== "linux") return Promise.resolve(undefined)
  return fs.readFile(`/proc/${pid}/status`, "utf8").then(fields, () => undefined)
}

async function childPids(pid: number) {
  const tasks = await fs.readdir(`/proc/${pid}/task`).catch(() => [] as string[])
  const lists = await Promise.all(
    tasks.map((task) => fs.readFile(`/proc/${pid}/task/${task}/children`, "utf8").catch(() => "")),
  )
  return [...new Set(lists.flatMap((list) => list.split(" ").filter(Boolean).map(Number)))]
}

function commandLine(raw: string) {
  return raw.split("\0").filter(Boolean).join(" ")
}

// /proc reports sizes as "1234 kB".
function kb(value: string | undefined) {
  return (Number.parseInt(value ?? "", 10) || 0) * 1024
}

export * as MemoryReport from "./memory"
