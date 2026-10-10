export * as SessionImport from "./service.js"

import { SessionImport } from "@opencode/schema/session-import"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Clock, Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { existsSync } from "node:fs"
import { Location } from "../../location.js"
import { Session } from "../../session.js"
import { SessionMessage } from "../message.js"
import { SessionTransfer } from "../transfer.js"
import { ClaudeCodeImport } from "./claude-code.js"
import { OpenCodeImport } from "./opencode.js"
import { ImportSource } from "./source.js"

export const Source = SessionImport.Source
export type Source = SessionImport.Source
export const SourceInfo = SessionImport.SourceInfo
export type SourceInfo = SessionImport.SourceInfo
export const Summary = SessionImport.Summary
export type Summary = SessionImport.Summary
export const UnavailableError = ImportSource.UnavailableError
export type UnavailableError = ImportSource.UnavailableError
export const NotFoundError = ImportSource.NotFoundError
export type NotFoundError = ImportSource.NotFoundError
export type Loaded = ImportSource.Loaded

export class AlreadyImportedError extends Schema.TaggedError<AlreadyImportedError>()(
  "SessionImport.AlreadyImportedError",
  { sessionID: Session.ID },
) {}

export class DirectoryNotFoundError extends Schema.TaggedError<DirectoryNotFoundError>()(
  "SessionImport.DirectoryNotFoundError",
  { directory: Schema.String },
) {}

export interface Result {
  /** The imported root session. */
  readonly session: Session.Info
  /** Every session imported, parents first; subagent sessions imported earlier are skipped. */
  readonly sessions: ReadonlyArray<Session.ID>
  readonly warnings: ReadonlyArray<string>
}

export interface Interface {
  readonly sources: () => Effect.Effect<ReadonlyArray<SourceInfo>>
  readonly list: (
    source: Source,
    input?: { readonly directory?: string; readonly limit?: number },
  ) => Effect.Effect<ReadonlyArray<Summary>, UnavailableError>
  readonly load: (source: Source, ref: string) => Effect.Effect<Loaded, UnavailableError | NotFoundError>
  /**
   * Import a foreign session and its subagent sessions under their original IDs, so a repeated
   * import reports the session as already imported. Sessions bind to the recorded directory
   * unless `location` overrides it.
   */
  readonly import: (
    source: Source,
    ref: string,
    input?: { readonly location?: Location.Ref },
  ) => Effect.Effect<Result, UnavailableError | NotFoundError | AlreadyImportedError | DirectoryNotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionImport") {}

export function configured(
  options: { readonly opencode?: ReadonlyArray<string>; readonly claudeCode?: ReadonlyArray<string> } = {},
) {
  return makeGlobalNode({
    service: Service,
    deps: [Session.node, SessionTransfer.node],
    layer: Layer.effect(
      Service,
      Effect.gen(function* () {
        const transfer = yield* SessionTransfer.Service
        const sessions = yield* Session.Service
        const adapters: Record<Source, ImportSource.Adapter> = {
          opencode: OpenCodeImport.adapter({ directories: options.opencode ?? OpenCodeImport.directories() }),
          "claude-code": ClaudeCodeImport.adapter({
            directories: options.claudeCode ?? ClaudeCodeImport.directories(),
          }),
        }
        const load = (source: Source, ref: string) => adapters[source].load(ref)

        return Service.of({
          sources: Effect.fn("SessionImport.sources")(function* () {
            return yield* Effect.forEach(Object.values(adapters), (adapter) => adapter.detect())
          }),
          list: Effect.fn("SessionImport.list")(function* (source, input) {
            return yield* adapters[source].list({
              directory: input?.directory ? ImportSource.directory(input.directory) : undefined,
              limit: input?.limit ?? 50,
            })
          }),
          load: Effect.fn("SessionImport.load")(function* (source, ref) {
            return yield* load(source, ref)
          }),
          import: Effect.fn("SessionImport.import")(function* (source, ref, input) {
            const loaded = yield* load(source, ref)
            const [root, ...children] = loaded.sessions
            // Report a repeated import before judging the history, which may have changed shape since.
            if (Option.isSome(yield* sessions.get(root.data.info.id).pipe(Effect.option)))
              return yield* new AlreadyImportedError({ sessionID: root.data.info.id })
            if (root.data.messages.length === 0 && root.warnings.length > 0)
              return yield* new ImportSource.UnavailableError({
                source,
                message: `${loaded.name} session ${ref} has no readable messages: ${root.warnings[0]}`,
              })
            const location = input?.location ?? root.data.info.location
            if (!input?.location && !(location.directory && existsSync(location.directory)))
              return yield* new DirectoryNotFoundError({ directory: location.directory })
            const importedAt = yield* Clock.currentTimeMillis
            const prepare = (session: ImportSource.Loaded["sessions"][number]) => ({
              ...session.data.info,
              metadata: {
                ...session.data.info.metadata,
                import: {
                  source,
                  sourceID: session.ref,
                  ...(session.version ? { sourceVersion: session.version } : {}),
                  path: loaded.path,
                  importedAt,
                  warnings: [...session.warnings],
                },
              },
            })
            const compactions = root.data.messages.filter((message) => message.type === "compaction").length
            const notice: SessionMessage.System = {
              id: SessionMessage.ID.create(),
              type: "system",
              text:
                `The conversation above was imported from ${loaded.name}. Its tool calls ran with ${loaded.name}'s tools, whose names and arguments may differ from yours; call only the tools available now.` +
                (loaded.note ? ` ${loaded.note}` : ""),
              description: `Imported from ${loaded.name} · ${count(root.data.messages.length, "message")} · ${count(children.length, "subagent")} · ${count(compactions, "compaction")}`,
              time: { created: DateTime.makeUnsafe(importedAt) },
            }
            const session = yield* transfer
              .import({ data: { info: prepare(root), messages: [...root.data.messages, notice] }, location })
              .pipe(
                Effect.catchTag(
                  "SessionTransfer.ImportConflictError",
                  (error) => new AlreadyImportedError({ sessionID: error.sessionID }),
                ),
                Effect.catchTag("Session.NotFoundError", Effect.die),
              )
            // Parents precede children, so every child's parent exists by the time it is imported.
            const imported = yield* Effect.forEach(children, (child) =>
              transfer.import({ data: { info: prepare(child), messages: child.data.messages }, location }).pipe(
                Effect.map((info) => Option.some(info.id)),
                Effect.catchTag("SessionTransfer.ImportConflictError", () => Effect.succeed(Option.none())),
                Effect.catchTag("Session.NotFoundError", Effect.die),
              ),
            )
            const skipped = children.filter((_, index) => Option.isNone(imported[index]))
            return {
              session,
              sessions: [session.id, ...imported.flatMap((id) => (Option.isSome(id) ? [id.value] : []))],
              warnings: [
                ...loaded.sessions.flatMap((item) => item.warnings),
                ...skipped.map((child) => `Subagent session ${child.ref} was already imported`),
              ],
            }
          }),
        })
      }),
    ),
  })
}

export const node = configured()

function count(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`
}
