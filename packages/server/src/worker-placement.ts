import { Worker } from "@opencode/schema/worker"
import { HostResources } from "@opencode/schema/host-resources"

/** A bounded admission check. Unknown measurements never imply unused resources. */
export function resourceQueueReason(
  requirements: Worker.Resources,
  sample: HostResources.Snapshot | undefined,
  reserved: { cpu: number; memoryBytes: number },
): Worker.QueueReason | undefined {
  if (!sample) return "resources-unavailable"
  const age = Date.now() - sample.sampledAt
  if (age > 30_000 || age < -5_000) return "resources-stale"
  if (sample.cpu.count === null) return "cpu-unavailable"
  if (sample.cpu.count - reserved.cpu < requirements.cpu) return "cpu-capacity"
  if (requirements.maxCpuUtilization !== undefined) {
    if (sample.cpu.utilization === null) return "cpu-load-unavailable"
    if (sample.cpu.utilization > requirements.maxCpuUtilization) return "cpu-load"
  }
  if (sample.memory.freeBytes === null) return "memory-unavailable"
  if (sample.memory.freeBytes - reserved.memoryBytes < requirements.memoryBytes) return "memory-capacity"
}
