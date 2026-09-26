export * as MonitorProcess from "./process.js"

import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"

type Identity = { started: string; group: number }
export type Probe = Identity | undefined | "unknown"

export const runner: {
  spawn: (command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) => SpawnSyncReturns<string>
} = { spawn: spawnSync }

const PROBE_OPTIONS: SpawnSyncOptionsWithStringEncoding = {
  encoding: "utf8",
  timeout: 2_000,
  env: { ...process.env, LC_ALL: "C" },
}

export const identifiable = process.platform === "linux" || process.platform === "darwin"
const probes = new Map<number, { at: number; value: Identity | undefined }>()

/** A definite process identity, definite absence, or an unknown result that cannot justify cleanup. */
export function processInfo(pid: number, platform: NodeJS.Platform = process.platform): Probe {
  if ((platform !== "linux" && platform !== "darwin") || !Number.isInteger(pid) || pid <= 0) return undefined
  if (platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
      if (fields[0] === "Z") return undefined
      const started = fields[19]
      return started ? { started, group: Number(fields[2]) } : "unknown"
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      return code === "ENOENT" || code === "ESRCH" ? undefined : "unknown"
    }
  }
  const cached = probes.get(pid)
  if (cached && Date.now() - cached.at < 5_000) return cached.value
  const result = runner.spawn("ps", ["-o", "pgid=", "-o", "lstart=", "-p", String(pid)], PROBE_OPTIONS)
  if (result.error || result.signal || typeof result.stdout !== "string") return "unknown"
  const match = /^\s*(\d+)\s+(\S.*?)\s*$/.exec(result.stdout)
  const value: Probe = match
    ? { group: Number(match[1]), started: match[2]! }
    : result.status === 1 && result.stdout.trim() === ""
      ? undefined
      : "unknown"
  if (value === "unknown") return value
  probes.set(pid, { at: Date.now(), value })
  return value
}

/** Count live members of a process group when the platform can establish that fact. */
export function groupMembers(group: number, platform: NodeJS.Platform = process.platform) {
  if (platform === "linux") {
    try {
      return readdirSync("/proc").filter((name) => {
        if (!/^\d+$/.test(name)) return false
        try {
          const stat = readFileSync(`/proc/${name}/stat`, "utf8")
          const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
          return fields[0] !== "Z" && Number(fields[2]) === group
        } catch {
          return false
        }
      }).length
    } catch {
      return undefined
    }
  }
  if (platform === "darwin") {
    const result = runner.spawn("pgrep", ["-g", String(group)], PROBE_OPTIONS)
    if (result.error || result.signal || typeof result.stdout !== "string") return undefined
    if (result.status === 1) return 0
    if (result.status !== 0) return undefined
    return result.stdout.split("\n").filter(Boolean).length
  }
  return undefined
}
