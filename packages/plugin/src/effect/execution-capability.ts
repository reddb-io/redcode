import type { ExecutionCapability } from "@opencode/schema/execution-capability"
import type { Effect, Scope } from "effect"

export interface ExecutionCapabilityDomain {
  /** Advertise one live capability for exactly the lifetime of the calling plugin scope. */
  readonly lease: (capability: ExecutionCapability.Info) => Effect.Effect<void, never, Scope.Scope>
}
