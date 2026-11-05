export * as AutomationCondition from "./condition.js"

import { Automation } from "@opencode/schema/automation"
import { Monitor } from "@opencode/schema/monitor"
import { MonitorProbe } from "../monitor-probe.js"

/** The initial condition types are read-only and never carry reusable credentials. */
export function problem(condition: Automation.Condition): string | undefined {
  const probe = condition.probe
  const invalid = Monitor.probeProblem(probe)
  if (invalid) return invalid
  if (probe.type !== "http") return
  const url = new URL(probe.url)
  if (url.username || url.password) return "HTTP condition URLs cannot contain credentials"
  if ("headers" in probe) return "HTTP conditions cannot contain headers"
  if (probe.json_path !== undefined && (probe.json_path.length > 200 || !Monitor.jsonPath(probe.json_path)))
    return "Invalid JSON path"
}

/** No shell or model call is involved; errors are not treated as a negative match. */
export async function observe(condition: Automation.Condition) {
  const invalid = problem(condition)
  if (invalid) throw new Error(`Invalid condition: ${invalid}`)
  const observation =
    condition.probe.type === "http"
      ? await MonitorProbe.http(condition.probe)
      : MonitorProbe.processCheck(condition.probe)
  if (observation.probe.error) throw new Error(observation.probe.error)
  return {
    matched: condition.when === "matches" ? observation.probe.matched : !observation.probe.matched,
    summary: observation.output.slice(0, 1000),
  }
}
