export * as ImportSource from "./source.js"

import { SessionImport } from "@opencode/schema/session-import"
import { SessionTransfer } from "@opencode/schema/session-transfer"
import { Effect, Schema } from "effect"
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
  return path.resolve(FSUtil.windowsPath(input))
}
