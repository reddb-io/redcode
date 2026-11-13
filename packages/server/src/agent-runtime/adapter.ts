import { Harness } from "@opencode/schema/harness"
import { Capability } from "@opencode/schema/capability"
import { type Frame, type Wire } from "../harness-wire"
import { type AgentRuntimeEvent, type AgentRuntimeEventInput } from "./events"
import type { ComputerUseBridge } from "../harness-tools"

export type AgentRuntimeCapabilities = {
  backgroundWork: boolean
  fork: boolean
  interrupt: boolean
  mcpApps: boolean
  multipleThreadsPerRuntime: boolean
  resume: boolean
  resumeAfterRestart: boolean
  steer: boolean
}

export type AgentRuntimeOpen = {
  appVersion: string
  directory: string
  run: Harness.Run
  wire: Wire
  computerUse?: ComputerUseBridge
}

export type AgentRuntimePrompt = {
  prompt: { id: string; text: string }
  run: Harness.Run
  steer: boolean
  turn: string
  wire: Wire
}

export type AgentRuntimeRequest = {
  frame: Frame
  request: Harness.Request
}

export type AgentRuntimeAdapter = {
  answer(input: { answer: Harness.Answer; item: AgentRuntimeRequest; wire: Wire }): void
  accepts(input: AgentRuntimeEventInput): boolean
  capabilities: AgentRuntimeCapabilities
  driver: Harness.Driver
  events(input: AgentRuntimeEventInput): AgentRuntimeEvent[]
  installPackage: string
  initialize(input: AgentRuntimeOpen): Promise<void>
  interrupt(input: { run: Harness.Run; turn: string; wire: Wire }): Promise<void>
  launchArgs(run: Harness.Run): string[]
  open(input: AgentRuntimeOpen): Promise<{ nativeID?: string }>
  prompt(input: AgentRuntimePrompt): Promise<{ turn?: string }>
}

export function harnessCapabilities(adapter: AgentRuntimeAdapter): Harness.Run["capabilities"] {
  const version = Capability.Version.make(1)
  return {
    protocol: Capability.Protocol.make(1),
    features: {
      ...(adapter.capabilities.backgroundWork ? { [Harness.Feature.backgroundWork]: version } : {}),
      ...(adapter.capabilities.fork ? { [Harness.Feature.fork]: version } : {}),
      ...(adapter.capabilities.interrupt ? { [Harness.Feature.interrupt]: version } : {}),
      ...(adapter.capabilities.mcpApps ? { [Harness.Feature.mcpApps]: version } : {}),
      ...(adapter.capabilities.multipleThreadsPerRuntime
        ? { [Harness.Feature.multipleThreadsPerRuntime]: version }
        : {}),
      ...(adapter.capabilities.resume ? { [Harness.Feature.resume]: version } : {}),
      ...(adapter.capabilities.resumeAfterRestart ? { [Harness.Feature.resumeAfterRestart]: version } : {}),
      ...(adapter.capabilities.steer ? { [Harness.Feature.steer]: version } : {}),
    },
    interrupt: adapter.capabilities.interrupt,
    resume: adapter.capabilities.resume,
    steer: adapter.capabilities.steer,
  }
}
