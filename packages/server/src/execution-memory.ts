import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { Context, Effect, Option, RcMap, Result } from "effect"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { SessionExecution } from "@opencode/core/session/execution"
import { Pty } from "@opencode/core/pty"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { Shell } from "@opencode/core/shell"
import { Harnesses } from "./harness"
import type { Memory } from "@opencode/schema/memory"

type ProcessRow = { pid: number; parent: number; bytes: number }
const exec = promisify(execFile)

/** Only numeric counters are collected; command lines and environment are never read. */
export async function processRows(): Promise<ProcessRow[] | undefined> {
  try {
    const windows = process.platform === "win32"
    if (!windows && process.platform !== "linux" && process.platform !== "darwin") return undefined
    const command = windows ? "powershell.exe" : "ps"
    const args = windows
      ? [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.WorkingSetSize }",
        ]
      : ["-axo", "pid=,ppid=,rss="]
    const { stdout } = await exec(command, args, { timeout: 10_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true })
    return stdout.split(/\r?\n/).flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line)
      if (!match) return []
      const [pid, parent, value] = match.slice(1).map(Number)
      if (!pid || parent === undefined || value === undefined) return []
      return [{ pid, parent, bytes: value * (windows ? 1 : 1024) }]
    })
  } catch {
    return undefined
  }
}

// Several viewers may request a sample at once; never spawn duplicate OS collectors.
let cached: { at: number; pending: boolean; value: Promise<ProcessRow[] | undefined> } | undefined
function sharedProcessRows() {
  const now = Date.now()
  if (cached && (cached.pending || now - cached.at < 10_000)) return cached.value
  const sample = { at: now, pending: true, value: processRows() }
  const value = sample.value.finally(() => {
    sample.pending = false
    const timer = setTimeout(() => {
      if (cached === sample) cached = undefined
    }, 10_000)
    timer.unref?.()
  })
  sample.value = value
  cached = sample
  return value
}

/** Check ancestry against this running server before accepting a PID, and count each subtree once. */
export function processTree(rows: ProcessRow[]) {
  const byPID = new Map(rows.map((row) => [row.pid, row]))
  const children = new Map<number, ProcessRow[]>()
  for (const row of rows) {
    const group = children.get(row.parent) ?? []
    group.push(row)
    children.set(row.parent, group)
  }
  return (root: number, owner: number | null = process.pid): number | null => {
    let current = byPID.get(root)
    const seen = new Set<number>()
    while (owner !== null && current && current.pid !== owner && !seen.has(current.pid)) {
      seen.add(current.pid)
      current = byPID.get(current.parent)
    }
    if (!current || (owner !== null && (current.pid !== owner || root === owner))) return null
    const queue = [root]
    const visited = new Set<number>()
    let total = 0
    while (queue.length) {
      const pid = queue.pop()!
      if (visited.has(pid)) continue
      visited.add(pid)
      const row = byPID.get(pid)
      if (!row) return null
      total += row.bytes
      for (const child of children.get(pid) ?? []) queue.push(child.pid)
    }
    return total
  }
}
export function treeMemory(rows: ProcessRow[], root: number, owner: number | null = process.pid) {
  return processTree(rows)(root, owner)
}

export const executionMemory = Effect.fn("server.executionMemory")(function* () {
  const locations = yield* LocationServiceMap.Service
  const executions = yield* SessionExecution.Service
  const harnesses = yield* Harnesses.Service
  const persistent = yield* PersistentPty.Service
  const allRefs = Array.from(yield* RcMap.keys(locations.rcMap))
  const refs = allRefs.slice(0, 200)
  const terminals = yield* Effect.forEach(
    refs,
    (ref) =>
      Effect.scoped(
        Effect.gen(function* () {
          const services = yield* locations.contextEffectOption(ref)
          if (Option.isNone(services)) return { terminals: [], tasks: [], complete: false }
          const terminals = (yield* Context.get(services.value, Pty.Service).list()).filter(
            (item) => item.status === "running",
          )
          const tasks = yield* Context.get(services.value, Shell.Service).list()
          return { terminals, tasks, complete: true }
        }),
      ).pipe(
        Effect.result,
        Effect.map((result) =>
          Result.isSuccess(result) ? result.success : { terminals: [], tasks: [], complete: false },
        ),
      ),
    { concurrency: 4 },
  )
  const shells = terminals.flatMap((item) => item.tasks).slice(0, 200)
  const localTerminals = terminals.flatMap((item) => item.terminals).slice(0, 200)
  // The daemon can survive a server restart; its own live inventory is authoritative.
  const persistentResult = yield* persistent.list().pipe(Effect.result)
  const persistentTerminals = (Result.isSuccess(persistentResult) ? persistentResult.success : [])
    .filter((item) => item.status === "running")
    .slice(0, 200)
  const agents = harnesses.memoryOwners().slice(0, 200)
  const shared = Array.from(yield* executions.active).slice(0, 200)
  const rows =
    localTerminals.length || persistentTerminals.length || shells.length || agents.length
      ? yield* Effect.promise(sharedProcessRows)
      : undefined
  const tree = rows && processTree(rows)
  const measure = (pid: number | null) => (pid && tree ? tree(pid) : null)
  const entries: Memory.Snapshot["entries"][number][] = []
  for (const item of localTerminals) {
    const residentBytes = measure(item.pid)
    entries.push({
      kind: "terminal",
      id: item.id,
      title: item.title,
      pid: item.pid,
      residentBytes,
      reason: residentBytes === null ? "unavailable" : null,
    })
  }
  for (const item of persistentTerminals) {
    const residentBytes = item.pid && tree ? tree(item.pid, null) : null
    entries.push({
      kind: "terminal",
      id: item.id,
      title: item.title,
      pid: item.pid || null,
      residentBytes,
      reason: residentBytes === null ? "unavailable" : null,
    })
  }
  for (const item of shells) {
    const pid = item.pid ?? null
    const residentBytes = measure(pid)
    entries.push({
      kind: "task",
      id: item.id,
      title: item.command.slice(0, 200),
      pid,
      residentBytes,
      reason: residentBytes === null ? "unavailable" : null,
    })
  }
  for (const item of agents) {
    const residentBytes = measure(item.pid)
    entries.push({
      kind: "agent",
      id: item.id,
      title: item.title,
      pid: item.pid,
      residentBytes,
      reason: residentBytes === null ? "unavailable" : null,
    })
    for (const task of item.tasks.slice(0, 100)) {
      const pid = task.processID && /^\d+$/.test(task.processID) ? Number(task.processID) : null
      // A numeric task PID is accepted only if it is a descendant of the owning harness.
      const bytes = pid && item.pid && tree && tree(pid, item.pid) !== null ? measure(pid) : null
      entries.push({
        kind: "task",
        id: `${item.id}:${task.id}`,
        title: task.title,
        pid,
        residentBytes: bytes,
        reason: bytes === null ? "unavailable" : null,
      })
    }
  }
  for (const id of shared)
    entries.push({ kind: "agent", id, title: id, pid: null, residentBytes: null, reason: "shared" })
  const complete =
    allRefs.length <= 200 &&
    terminals.every((item) => item.complete) &&
    Result.isSuccess(persistentResult) &&
    terminals.reduce((total, item) => total + item.terminals.length, 0) <= 200 &&
    terminals.reduce((total, item) => total + item.tasks.length, 0) <= 200 &&
    Result.isSuccess(persistentResult) &&
    persistentResult.success.length <= 200 &&
    agents.length < 200 &&
    agents.every((item) => item.tasks.length < 100 && !item.tasksLimited) &&
    shared.length < 200 &&
    entries.length <= 500
  return { sampledAt: Date.now(), complete, entries: entries.slice(0, 500) } satisfies Memory.Snapshot
})
