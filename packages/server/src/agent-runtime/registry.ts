import { Harness } from "@opencode/schema/harness"
import { type AgentRuntimeAdapter } from "./adapter"
import { ClaudeAgentRuntime } from "./adapters/claude"
import { CodexAgentRuntime } from "./adapters/codex"

const adapters = new Map<Harness.Driver, AgentRuntimeAdapter>(
  [ClaudeAgentRuntime, CodexAgentRuntime].map((adapter) => [adapter.driver, adapter]),
)

export function agentRuntime(driver: Harness.Driver) {
  const adapter = adapters.get(driver)
  if (!adapter) throw new Error(`Unsupported agent runtime: ${driver}`)
  return adapter
}

export function agentRuntimes() {
  return [...adapters.values()]
}
