import { expect, test } from "bun:test"
import { HostResources } from "@opencode/schema/host-resources"
import { resourceQueueReason } from "../src/worker-placement"

test("resource admission distinguishes unknown, stale, exhausted and busy measurements", () => {
  const sample: HostResources.Snapshot = {
    sampledAt: Date.now(),
    platform: "linux arm64",
    cpu: { count: 4, utilization: 0.2 },
    memory: { totalBytes: 8192, freeBytes: 4096 },
    process: { pid: 1, residentBytes: 1024 },
  }
  const need = { cpu: 2, memoryBytes: 2048, maxCpuUtilization: 0.8 }
  const reserved = { cpu: 0, memoryBytes: 0 }
  expect(resourceQueueReason(need, sample, reserved)).toBeUndefined()
  expect(resourceQueueReason(need, undefined, reserved)).toBe("resources-unavailable")
  expect(resourceQueueReason(need, { ...sample, sampledAt: sample.sampledAt - 31_000 }, reserved)).toBe(
    "resources-stale",
  )
  expect(resourceQueueReason(need, { ...sample, sampledAt: sample.sampledAt + 10_000 }, reserved)).toBe(
    "resources-stale",
  )
  expect(resourceQueueReason(need, { ...sample, cpu: { count: null, utilization: null } }, reserved)).toBe(
    "cpu-unavailable",
  )
  expect(resourceQueueReason(need, sample, { ...reserved, cpu: 3 })).toBe("cpu-capacity")
  expect(resourceQueueReason(need, { ...sample, cpu: { count: 4, utilization: null } }, reserved)).toBe(
    "cpu-load-unavailable",
  )
  expect(resourceQueueReason(need, { ...sample, cpu: { count: 4, utilization: 0.81 } }, reserved)).toBe("cpu-load")
  expect(resourceQueueReason(need, { ...sample, memory: { totalBytes: null, freeBytes: null } }, reserved)).toBe(
    "memory-unavailable",
  )
  expect(resourceQueueReason(need, sample, { ...reserved, memoryBytes: 2049 })).toBe("memory-capacity")
  expect(
    resourceQueueReason({ cpu: 2, memoryBytes: 2048 }, { ...sample, cpu: { count: 4, utilization: null } }, reserved),
  ).toBeUndefined()
})
