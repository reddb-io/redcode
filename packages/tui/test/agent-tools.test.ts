import { expect, test } from "bun:test"
import { ExecutionCapability } from "@opencode/schema/execution-capability"
import { operationalCapabilityOptions } from "../src/feature-plugins/system/agent-tools"

test("formats plugin provenance and execution target for the capability dialog", () => {
  const options = operationalCapabilityOptions([
    ExecutionCapability.Info.make({
      id: ExecutionCapability.ID.make("desktop:test"),
      name: "Desktop control",
      kind: "desktop",
      source: "managed",
      status: "ready",
      risk: "privileged",
      target: { type: "worker", id: "worker-1", name: "Build workstation" },
      provider: { type: "plugin", id: "computer-use", name: "Computer Use" },
      operations: ["desktop.observe", "desktop.interact"],
    }),
  ])

  expect(options).toHaveLength(1)
  expect(options[0]).toMatchObject({ title: "Desktop control", category: "desktop", footer: "ready" })
  expect(options[0]?.details).toEqual([
    "worker · Build workstation",
    "Source: managed",
    "Plugin: Computer Use",
    "Operations: desktop.observe, desktop.interact",
  ])
})

test("accepts the empty inventory returned for older servers", () => {
  expect(operationalCapabilityOptions([])).toEqual([])
})
