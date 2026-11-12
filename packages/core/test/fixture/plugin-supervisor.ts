import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Effect, Layer } from "effect"

// Fixtures that install their own tools have no background plugin generation to refresh.
export const idlePluginSupervisor = Layer.succeed(PluginSupervisor.Service, {
  refresh: Effect.void,
  pending: () => false,
})
