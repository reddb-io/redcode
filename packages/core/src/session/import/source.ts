export * as ImportSource from "./source.js"

import { SessionImport } from "@opencode/schema/session-import"
import { SessionTransfer } from "@opencode/schema/session-transfer"
import { Effect, Schema } from "effect"
import { createHash } from "node:crypto"
import path from "node:path"
import { FSUtil } from "@opencode/util/fs-util"

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("SessionImport.UnavailableError", {
  source: SessionImport.Source,
  message: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("SessionImport.NotFoundError", {
  source: SessionImport.Source,
  ref: Schema.String,
}) {}

/** One foreign session tree, normalized to transfer data with its parents before its children. */
export interface Loaded {
  readonly source: SessionImport.Source
  readonly name: string
  /** The store the sessions were read from. */
  readonly path: string
  /** Model-facing guidance appended to the closing import note, such as how the source's tools map to Redcode's. */
  readonly note?: string
  readonly sessions: ReadonlyArray<{
    readonly ref: string
    readonly version?: string
    readonly data: SessionTransfer.Data
    readonly warnings: ReadonlyArray<string>
  }>
}

/**
 * A foreign coding agent's local session store. Each adapter reads its store without writing to
 * it and normalizes the history it finds; the import service owns placement and persistence.
 */
export interface Adapter {
  readonly source: SessionImport.Source
  readonly name: string
  readonly detect: () => Effect.Effect<SessionImport.SourceInfo>
  readonly list: (input: {
    readonly directory?: string
    readonly limit: number
  }) => Effect.Effect<ReadonlyArray<SessionImport.Summary>, UnavailableError>
  readonly load: (ref: string) => Effect.Effect<Loaded, UnavailableError | NotFoundError>
}

/** A source-recorded directory in this host's canonical form; empty when the source recorded none. */
export function directory(input: string) {
  if (!input) return ""
  // Windows long-path prefixes (`\\?\C:\…`, `\\?\UNC\server\share`) name the same directory as the plain path.
  const plain = input.replace(/^[\\/]{2}\?[\\/]UNC[\\/]/i, "\\\\").replace(/^[\\/]{2}\?[\\/]/, "")
  // Drive letters are case-insensitive; keep them upper case so one directory has one spelling.
  return path.resolve(FSUtil.windowsPath(plain)).replace(/^[a-z](?=:)/, (drive) => drive.toUpperCase())
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/**
 * A Redcode ID for a foreign record whose source ID is not Redcode-shaped. Like Redcode's own IDs it
 * starts with a time prefix (`time` is milliseconds × 0x1000 plus a counter; Session IDs descend),
 * followed by a hash of `seed` instead of random characters, so importing the same record again
 * yields the same ID.
 */
export function stableID(prefix: "ses" | "msg", seed: string, time: bigint, descending = false) {
  const value = descending ? ~time : time
  const stamp = Array.from({ length: 6 }, (_, index) =>
    Number((value >> BigInt(40 - 8 * index)) & 0xffn)
      .toString(16)
      .padStart(2, "0"),
  ).join("")
  const hash = BigInt(`0x${createHash("sha256").update(seed).digest("hex")}`)
  const suffix = Array.from({ length: 14 }, (_, index) => BASE62[Number((hash / 62n ** BigInt(13 - index)) % 62n)])
  return `${prefix}_${stamp}${suffix.join("")}`
}
