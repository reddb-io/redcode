export * as WorkspaceV2 from "./workspace"

import { Workspace } from "@reddb-io/redcode-schema/workspace"

export const ID = Workspace.ID
export type ID = typeof ID.Type
