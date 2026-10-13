export * as HostResources from "./host-resources.js"

import { Schema } from "effect"

/** A demand-driven host sample. Missing measurements are unknown, never zero usage. */
export const Snapshot = Schema.Struct({
  sampledAt: Schema.Finite,
  platform: Schema.String,
  cpu: Schema.Struct({
    count: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
    utilization: Schema.NullOr(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
  }),
  memory: Schema.Struct({
    totalBytes: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThan(0))),
    /** Free memory reported by the OS, not a reservation or guaranteed task capacity. */
    freeBytes: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
  process: Schema.Struct({
    pid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    residentBytes: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
}).annotate({ identifier: "HostResources.Snapshot" })
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
