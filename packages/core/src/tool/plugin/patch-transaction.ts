export * as PatchTransaction from "./patch-transaction.js"

import path from "node:path"
import { Cause, Effect, Exit } from "effect"
import type { Environment } from "../../environment/index.js"

export type Snapshot = {
  readonly type: Environment.FileType
  readonly size: number
  readonly mtimeMs: number
  readonly bytes?: Uint8Array
} | undefined

export type Operation =
  | { readonly type: "write"; readonly path: string; readonly content: Uint8Array }
  | { readonly type: "remove"; readonly path: string }

type Undo =
  | { readonly type: "write"; readonly path: string; readonly before: Snapshot }
  | { readonly type: "remove"; readonly path: string; readonly backup: string }
  | { readonly type: "directory"; readonly path: string }

export class StaleError extends Error {
  constructor(readonly paths: readonly string[]) {
    super(`Patch rejected: ${paths.join(", ")} changed after verification. No files were changed; re-read and retry.`)
  }
}

export class CommitError extends Error {
  constructor(
    readonly failed: { readonly path: string; readonly reason: string },
    readonly rolledBack: readonly string[],
    readonly rollbackFailed: readonly { readonly path: string; readonly reason: string }[],
  ) {
    super(
      `Patch failed at ${failed.path}: ${failed.reason}. ` +
        (rollbackFailed.length
          ? `Rollback incomplete: ${rollbackFailed.map((item) => `${item.path} (${item.reason})`).join(", ")}.`
          : `No patch changes remain. Rolled back: ${rolledBack.join(", ") || "none"}.`),
    )
  }
}

export function snapshot(files: Environment.Files, target: string) {
  return Effect.gen(function* () {
    const info = yield* files.stat(target).pipe(Effect.catchTag("Environment.NotFound", () => Effect.undefined))
    if (info === undefined) return undefined
    if (info.type !== "file" && info.type !== "symlink") return info
    const bytes = yield* files.read(target).pipe(
      Effect.map((result) => result.bytes),
      Effect.catchTag("Environment.NotFound", () => Effect.undefined),
      Effect.catchTag("Environment.WrongKind", () => Effect.undefined),
    )
    return { ...info, bytes }
  })
}

export function same(left: Snapshot, right: Snapshot) {
  if (left?.type !== right?.type) return false
  if (left === undefined || right === undefined) return left === right
  if (left.bytes === undefined || right.bytes === undefined)
    return left.bytes === right.bytes && left.size === right.size && left.mtimeMs === right.mtimeMs
  const bytes = right.bytes
  return left.bytes.length === bytes.length && left.bytes.every((byte, index) => byte === bytes[index])
}

/** Back up removed entries with same-directory moves so rollback keeps symlinks and file modes. */
export const commit = Effect.fn("PatchTransaction.commit")(function* (
  files: Environment.Files,
  operations: readonly Operation[],
  originals: ReadonlyMap<string, Snapshot>,
) {
  return yield* Effect.uninterruptible(Effect.gen(function* () {
    const stale = yield* Effect.filter([...originals], ([target, before]) =>
      snapshot(files, target).pipe(Effect.map((current) => !same(before, current))),
    )
    if (stale.length) return yield* Effect.fail(new StaleError(stale.map(([target]) => target)))

    const undo: Undo[] = []
    for (const operation of operations) {
      const result = yield* Effect.exit(Effect.gen(function* () {
        if (operation.type === "write") {
          const before = yield* snapshot(files, operation.path)
          if (before?.type === "symlink" && before.bytes === undefined)
            return yield* Effect.fail(new Error(`Cannot write through an unreadable symlink: ${operation.path}`))
          const missing: string[] = []
          for (let parent = path.dirname(operation.path); parent !== path.dirname(parent); parent = path.dirname(parent)) {
            const info = yield* files.stat(parent).pipe(Effect.catchTag("Environment.NotFound", () => Effect.undefined))
            if (info !== undefined) break
            missing.unshift(parent)
          }
          undo.push(...missing.map((target): Undo => ({ type: "directory", path: target })))
          undo.push({ type: "write", path: operation.path, before })
          yield* files.write(operation.path, operation.content)
          return
        }
        const backup = path.join(
          path.dirname(operation.path),
          `.${path.basename(operation.path)}.${crypto.randomUUID()}.patch-backup`,
        )
        undo.push({ type: "remove", path: operation.path, backup })
        yield* files.move(operation.path, backup)
      }))
      if (Exit.isSuccess(result)) continue
      const rolledBack: string[] = []
      const rollbackFailed: { path: string; reason: string }[] = []
      for (const step of undo.toReversed()) {
        const restored = yield* Effect.exit(restore(files, step))
        if (Exit.isSuccess(restored)) rolledBack.unshift(step.path)
        else rollbackFailed.unshift({ path: step.path, reason: reason(restored.cause) })
      }
      return yield* Effect.fail(new CommitError(
        { path: operation.path, reason: reason(result.cause) },
        rolledBack,
        rollbackFailed,
      ))
    }

    yield* Effect.forEach(
      undo.filter((step): step is Extract<Undo, { type: "remove" }> => step.type === "remove"),
      (step) => files.remove(step.backup).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to clean patch backup", { path: step.backup, cause }),
        ),
      ),
      { discard: true },
    )
  }))
})

function restore(files: Environment.Files, step: Undo) {
  if (step.type === "directory")
    return files.list(step.path).pipe(
      Effect.flatMap((entries) => entries.length === 0 ? files.remove(step.path) : Effect.void),
      Effect.catchTag("Environment.NotFound", () => Effect.void),
    )
  if (step.type === "write") {
    if (step.before?.bytes) return files.write(step.path, step.before.bytes)
    if (step.before === undefined) return files.remove(step.path)
    return Effect.void
  }
  return files.stat(step.backup).pipe(
    Effect.flatMap(() => files.move(step.backup, step.path)),
    Effect.catchTag("Environment.NotFound", () =>
      files.stat(step.path).pipe(Effect.asVoid),
    ),
  )
}

const reason = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  if (error !== null && typeof error === "object" && "cause" in error && error.cause instanceof Error)
    return error.cause.message
  return error instanceof Error ? error.message : String(error)
}
