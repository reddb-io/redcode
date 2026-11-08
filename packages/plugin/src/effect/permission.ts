import type { PermissionApi } from "@opencode/client/effect/api"
import type { Agent } from "@opencode/schema/agent"
import type { Permission } from "@opencode/schema/permission"
import type { Session } from "@opencode/schema/session"
import type { Tool } from "@opencode/schema/tool"
import type { Hooks } from "./registration.js"

export interface PermissionEvaluation {
  readonly sessionID: Session.ID
  readonly agent?: Agent.ID
  readonly action: string
  readonly resources: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
  readonly source?: Permission.Source
  effect: Permission.Effect
  message?: string
}

export interface PermissionHooks {
  readonly evaluate: PermissionEvaluation
}

export type PermissionDomain = Pick<PermissionApi<unknown>, "list" | "get" | "reply"> & {
  readonly hook: Hooks<PermissionHooks>
  /**
   * Authorize one plugin-owned operation through the same session permission flow as
   * built-in tools. A rejected request remains an execution failure; plugins must not
   * convert it into a successful tool result or retry it through another capability.
   */
  readonly assert: (input: {
    readonly sessionID: Session.ID
    readonly agent?: Agent.ID
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: Record<string, unknown>
    readonly source?: Permission.Source
  }) => import("effect").Effect.Effect<void, Tool.Error>
}
