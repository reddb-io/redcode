import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@reddb-io/redcode-core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~redcode/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~redcode/WorkspaceRef", {
  defaultValue: () => undefined,
})
