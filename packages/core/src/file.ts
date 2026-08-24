export * as File from "./file"

import { Revert } from "@reddb-io/redcode-schema/revert"

export const Diff = Revert.FileDiff
export type Diff = typeof Diff.Type
