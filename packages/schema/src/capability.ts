export * as Capability from "./capability.js"

import { Schema } from "effect"
import { PositiveInt } from "./schema.js"

export const Protocol = PositiveInt.pipe(Schema.brand("Capability.Protocol"))
export type Protocol = typeof Protocol.Type

export const Version = PositiveInt.pipe(Schema.brand("Capability.Version"))
export type Version = typeof Version.Type

/** Open feature namespace so newer peers remain decodable by older clients. */
export const Features = Schema.Record(Schema.String, Version).annotate({ identifier: "Capability.Features" })
export interface Features extends Schema.Schema.Type<typeof Features> {}

export function supports(features: Readonly<Record<string, number>> | undefined, feature: string, minimum = 1) {
  const version = features?.[feature]
  return version !== undefined && version >= minimum
}
