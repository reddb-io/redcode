import { cpus, freemem, totalmem } from "node:os"
import { HostResources } from "@opencode/schema/host-resources"

export type CpuSample = { count: number; idle: number; total: number; sampledAt: number }

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
  const state: { previous?: CpuSample } = {}
  return (): HostResources.Snapshot => {
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
    const utilization = cpuUtilization(state.previous, sample)
    state.previous = sample
    const total = totalmem()
    return {
      sampledAt,
      platform: `${process.platform} ${process.arch}`,
      cpu: { count: sample.count || null, utilization },
      memory: { totalBytes: total > 0 ? total : null, freeBytes: total > 0 ? freemem() : null },
      process: { pid: process.pid ?? 0, residentBytes: process.memoryUsage().rss },
    }
  }
}
