import type { OpenCode } from "./client.js"

export * from "./generated/index.js"
export { OpenCode } from "./client.js"
export { Harness } from "@opencode/schema/harness"
export { UsageReporter } from "@opencode/schema/usage-reporter"
export type {
  AgentApi,
  CommandApi,
  ConfigApi,
  EventApi,
  IntegrationApi,
  ModelApi,
  PluginApi,
  ProviderApi,
  ReferenceApi,
  RpcApi,
  RpcCallOptions,
  RpcClient,
  RpcEventPayload,
  WebSearchApi,
  SessionApi,
  SkillApi,
} from "./api.js"
export type { EventSubscribeOutput as OpenCodeEvent } from "./generated/types.js"
export type OpenCodeClient = ReturnType<typeof OpenCode.make>
