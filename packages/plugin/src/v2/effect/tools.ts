import type { Effect, Scope } from "effect"
import type { ToolSpec } from "../tools.js"

export interface ToolHooks {
  readonly register: (tools: Readonly<Record<string, ToolSpec>>) => Effect.Effect<void, never, Scope.Scope>
}
