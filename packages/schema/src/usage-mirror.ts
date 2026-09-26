export * as UsageMirror from "./usage-mirror.js"

import { Schema } from "effect"

export const Backfill = Schema.Struct({
  sidecar: Schema.String,
  mirrored: Schema.Int,
  skipped: Schema.Int,
}).annotate({ identifier: "UsageMirror.Backfill" })
export type Backfill = typeof Backfill.Type
