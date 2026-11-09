export * as ServerCapabilities from "./server-capabilities.js"

import { Schema } from "effect"
import { Capability } from "./capability.js"
import { optional } from "./schema.js"

/** Stable wire names. Add a version instead of inventing a new boolean when a contract evolves compatibly. */
export const Feature = {
  eventAcknowledgement: "event.ack",
  eventResume: "event.resume",
  executionGraph: "session.execution-graph",
  sessionObservation: "session.observation",
  workerLease: "worker.lease",
} as const
export type Feature = (typeof Feature)[keyof typeof Feature]

export const Protocol = Capability.Protocol
export type Protocol = Capability.Protocol

export const Version = Capability.Version
export type Version = Capability.Version

export const Info = Schema.Struct({
  /** Version of the capability-negotiation envelope, independent from the Redcode release. */
  protocol: Protocol.pipe(optional),
  /** Arbitrary forward-compatible feature names mapped to their supported contract version. */
  features: Capability.Features.pipe(optional),
  /** Legacy compatibility fields retained while old coordinators still read them. */
  sessionObservation: Schema.Boolean.pipe(optional),
  workerLease: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "ServerCapabilities.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

/**
 * Reads the versioned map first and bridges the two capabilities advertised by older Redcode servers.
 * Unknown features are unsupported rather than inferred from release versions or endpoint presence.
 */
export function supports(
  info:
    | {
        readonly features?: Readonly<Record<string, number>>
        readonly sessionObservation?: boolean
        readonly workerLease?: boolean
      }
    | undefined,
  feature: string,
  minimum = 1,
) {
  if (info?.features?.[feature] !== undefined) return Capability.supports(info.features, feature, minimum)
  if (feature === Feature.sessionObservation) return minimum <= 1 && info?.sessionObservation === true
  if (feature === Feature.workerLease) return minimum <= 1 && info?.workerLease === true
  return false
}
