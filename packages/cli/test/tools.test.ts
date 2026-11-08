import { expect, test } from "bun:test"
import { AgentTools } from "@opencode/schema/agent-tools"
import { ExecutionCapability } from "@opencode/schema/execution-capability"
import { formatList } from "../src/commands/handlers/tools"

test("lists operational capability providers and execution targets when available", () => {
  const output = formatList(
    AgentTools.Snapshot.make({
      host: { name: "workstation", platform: "linux", arch: "x64" },
      tools: [],
      capabilities: [
        ExecutionCapability.Info.make({
          id: ExecutionCapability.ID.make("browser:test"),
          name: "Existing browser",
          kind: "browser",
          source: "custom",
          status: "ready",
          risk: "privileged",
          target: { type: "server", id: "workstation", name: "workstation" },
          provider: { type: "plugin", id: "browser-plugin" },
          operations: ["browser.observe"],
        }),
      ],
    }),
  )

  expect(output).toContain("Operational capabilities")
  expect(output).toContain("browser\tready\tExisting browser\tserver:workstation\tplugin:browser-plugin")
})

test("keeps list output compatible with servers that omit capabilities", () => {
  const output = formatList(
    AgentTools.Snapshot.make({
      host: { name: "old-server", platform: "linux", arch: "x64" },
      tools: [],
    }),
  )

  expect(output).toBe("old-server (linux/x64)\nAgent tools\n")
})
