import { encode } from "@reddb-io/toon"

export const encodeResponse = (value: Record<string, unknown>): string => encode(value)
export const encodeToon = encode
