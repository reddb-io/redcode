import { availableParallelism, cpus, freemem, totalmem } from "node:os"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { HostResources } from "@opencode/schema/host-resources"

export type CpuSample = { count: number; idle: number; total: number; sampledAt: number }
export type CgroupCpuSample = { source: string; usageMicros: number; capacity: number; sampledAt: number }

export function cgroupCpuUtilization(previous: CgroupCpuSample | undefined, current: CgroupCpuSample) {
  if (!previous || previous.source !== current.source || previous.capacity !== current.capacity) return null
  const elapsed = current.sampledAt - previous.sampledAt
  const used = current.usageMicros - previous.usageMicros
  if (elapsed <= 0 || elapsed > 30_000 || used < 0 || current.capacity <= 0) return null
  return Math.min(1, used / (elapsed * 1000 * current.capacity))
}

/** Parse only bounded kernel numbers; `max`, absent and malformed values remain unknown. */
export function cgroupMeasurements(input: {
  cpuMax?: string
  cpuStat?: string
  memoryMax?: string
  memoryCurrent?: string
}) {
  const number = (value: string | undefined) =>
    value !== undefined && /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined
  const quota = input.cpuMax?.trim().split(/\s+/)
  const amount = number(quota?.[0])
  const period = number(quota?.[1])
  const maximum = number(input.memoryMax)
  return {
    cpu: amount && period ? amount / period : undefined,
    usageMicros: number(input.cpuStat?.match(/^usage_usec\s+(\d+)$/m)?.[1]),
    memoryMax: maximum && maximum > 0 ? maximum : undefined,
    memoryCurrent: number(input.memoryCurrent),
  }
}

async function cgroup() {
  if (process.platform !== "linux") return undefined
  const membership = await readFile("/proc/self/cgroup", "utf8").catch(() => undefined)
  const relative = membership
    ?.split("\n")
    .find((line) => line.startsWith("0::"))
    ?.slice(3)
  if (!relative) return undefined
  const directory = path.posix.resolve("/sys/fs/cgroup", `.${relative}`)
  if (directory !== "/sys/fs/cgroup" && !directory.startsWith("/sys/fs/cgroup/")) return undefined
  const [cpuMax, cpuStat, memoryMax, memoryCurrent] = await Promise.all(
    ["cpu.max", "cpu.stat", "memory.max", "memory.current"].map((file) =>
      readFile(path.join(directory, file), "utf8").catch(() => undefined),
    ),
  )
  return { source: directory, ...cgroupMeasurements({ cpuMax, cpuStat, memoryMax, memoryCurrent }) }
}

/** Compare cumulative OS counters; reset or unavailable counters cannot imply a healthy idle host. */
export function cpuUtilization(previous: CpuSample | undefined, current: CpuSample) {
  if (!previous || current.count === 0 || previous.count !== current.count) return null
  if (current.sampledAt <= previous.sampledAt || current.sampledAt - previous.sampledAt > 30_000) return null
  const total = current.total - previous.total
  const idle = current.idle - previous.idle
  if (total <= 0 || idle < 0 || idle > total) return null
  return (total - idle) / total
}

/** Each server owns its sampler. No timer, process collector, history or database scan is started. */
export function createHostResources() {
  const state: { previous?: CpuSample; group?: CgroupCpuSample } = {}
  return async (): Promise<HostResources.Snapshot> => {
    const group = await cgroup()
    const processors = cpus()
    const sampledAt = Date.now()
    const sample = processors.reduce(
      (current, cpu) => ({
        count: processors.length,
        sampledAt,
        idle: current.idle + cpu.times.idle,
        total: current.total + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq,
      }),
      { count: processors.length, idle: 0, total: 0, sampledAt },
    )
    const parallelism = availableParallelism()
    const capacity = Math.min(parallelism, group?.cpu ?? parallelism)
    const current =
      group?.usageMicros !== undefined
        ? { source: group.source, usageMicros: group.usageMicros, capacity, sampledAt }
        : undefined
    const utilization = current
      ? cgroupCpuUtilization(state.group, current)
      : parallelism < processors.length || group?.cpu !== undefined
        ? null
        : cpuUtilization(state.previous, sample)
    state.group = current
    state.previous = sample
    const total = totalmem()
    const constrained = process.constrainedMemory?.() ?? 0
    const limit = Math.min(total, constrained > 0 ? constrained : total, group?.memoryMax ?? total)
    const free =
      limit === total
        ? freemem()
        : group?.memoryMax === limit && group.memoryCurrent !== undefined
          ? Math.min(freemem(), Math.max(0, limit - group.memoryCurrent))
          : null
    return {
      sampledAt,
      platform: `${process.platform} ${process.arch}`,
      cpu: { count: capacity > 0 ? Math.ceil(capacity) : null, utilization },
      memory: { totalBytes: limit > 0 ? limit : null, freeBytes: limit > 0 ? free : null },
      process: { pid: process.pid ?? 0, residentBytes: process.memoryUsage().rss },
    }
  }
}
