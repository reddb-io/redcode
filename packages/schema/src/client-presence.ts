export * as ClientPresence from "./client-presence.js"

import { Schema } from "effect"
import { NonNegativeInt } from "./schema.js"

export const Surface = Schema.Literals(["desktop", "web", "tui", "cli", "api", "automation", "worker", "unknown"]).annotate({
  identifier: "ClientPresence.Surface",
})
export type Surface = typeof Surface.Type

export const SURFACE_HEADER = "x-redcode-surface"
export const CLIENT_ID_HEADER = "x-redcode-client-id"
export const VERSION_HEADER = "x-redcode-client-version"

export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
export const Snapshot = Schema.Struct({
  total: NonNegativeInt,
  desktop: NonNegativeInt,
  web: NonNegativeInt,
  tui: NonNegativeInt,
  cli: NonNegativeInt,
  api: NonNegativeInt,
  automation: NonNegativeInt,
  worker: NonNegativeInt,
  unknown: NonNegativeInt,
}).annotate({ identifier: "ClientPresence.Snapshot" })
