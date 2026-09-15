import { Cause, Effect, Exit } from "effect"
import * as NFS from "fs/promises"
import * as path from "path"
import type { FSUtil } from "@reddb-io/redcode-core/fs-util"

/**
 * Commits a fully staged multi-file change set.
 *
 * Callers stage every change in memory first; this module only touches disk.
 * It re-checks that every target still has the staged original bytes, creates
 * missing directories, writes each file atomically (temp file + rename in the
 * same directory, keeping the original mode), and then deletes files, children
 * before parents. When a step fails, the steps already applied are rolled back
 * from the in-memory originals and the error lists what was applied, what was
 * rolled back and what could not be.
 */

export interface Original {
  readonly bytes: Uint8Array
  readonly mode: number
  /** Link text when the path itself is a symlink; rollback of a delete recreates the link. */
  readonly link?: string
}

export interface Write {
  readonly path: string
  readonly content: Uint8Array
  /** Missing when the file does not exist yet. */
  readonly original?: Original
}

export interface Delete {
  readonly path: string
  readonly original: Original
}

export interface Plan {
  readonly writes: ReadonlyArray<Write>
  readonly deletes: ReadonlyArray<Delete>
}

export interface Failure {
  readonly path: string
  readonly reason: string
}

export class StaleError extends Error {
  constructor(readonly paths: ReadonlyArray<string>) {
    super(`files changed on disk after the patch was verified: ${paths.join(", ")}`)
  }
}

export class CommitError extends Error {
  constructor(
    readonly failed: Failure,
    /** Steps that completed before the failure. */
    readonly applied: ReadonlyArray<string>,
    readonly rolledBack: ReadonlyArray<string>,
    readonly rollbackFailed: ReadonlyArray<Failure>,
    /** Steps never attempted. */
    readonly notApplied: ReadonlyArray<string>,
  ) {
    super(`failed to commit ${failed.path}: ${failed.reason}`)
  }
}

export interface Result {
  readonly written: ReadonlyArray<string>
  readonly deleted: ReadonlyArray<string>
}

type Step = { readonly kind: "write"; readonly op: Write } | { readonly kind: "delete"; readonly op: Delete }

const reason = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  return error instanceof Error ? error.message : String(error)
}

const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((byte, index) => byte === right[index])

const depth = (file: string) => path.resolve(file).split(path.sep).length

export const atomicWrite = (fs: FSUtil.Interface, target: string, bytes: Uint8Array, mode?: number) =>
  Effect.gen(function* () {
    const temp = path.join(
      path.dirname(target),
      `.${path.basename(target)}.${process.pid}.${Math.random().toString(36).slice(2)}.redcode-tmp`,
    )
    const exit = yield* Effect.exit(
      Effect.gen(function* () {
        // Create the temp file exclusively and with the target's mode, so its content is never
        // readable with wider permissions than the file it replaces. chmod then undoes the umask.
        yield* fs.writeFile(temp, bytes, { flag: "wx", mode: mode === undefined ? 0o666 : mode & 0o7777 })
        if (mode !== undefined) yield* fs.chmod(temp, mode & 0o7777)
        yield* fs.rename(temp, target)
      }),
    )
    if (Exit.isSuccess(exit)) return exit.value
    yield* Effect.exit(fs.remove(temp))
    return yield* Effect.failCause(exit.cause)
  })

export const commit = (fs: FSUtil.Interface, plan: Plan) =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      const stale: string[] = []
      const expect = (file: string, original: Original | undefined) =>
        Effect.gen(function* () {
          if (original === undefined) {
            if (yield* fs.existsSafe(file)) stale.push(file)
            return
          }
          const current = yield* Effect.exit(fs.readFile(file))
          if (Exit.isFailure(current) || !sameBytes(current.value, original.bytes)) stale.push(file)
        })
      for (const op of plan.writes) yield* expect(op.path, op.original)
      for (const op of plan.deletes) yield* expect(op.path, op.original)
      if (stale.length > 0) return yield* Effect.fail(new StaleError(stale))

      const steps: Step[] = [
        ...plan.writes.map((op): Step => ({ kind: "write", op })),
        ...[...plan.deletes].sort((a, b) => depth(b.path) - depth(a.path)).map((op): Step => ({ kind: "delete", op })),
      ]
      const done: Step[] = []
      const created: string[] = []

      const rollback = (failed: Failure, remaining: ReadonlyArray<Step>) =>
        Effect.gen(function* () {
          const rolledBack: string[] = []
          const rollbackFailed: Failure[] = []
          for (const step of [...done].reverse()) {
            const undo =
              step.kind === "delete"
                ? step.op.original.link !== undefined
                  ? fs.symlink(step.op.original.link, step.op.path)
                  : atomicWrite(fs, step.op.path, step.op.original.bytes, step.op.original.mode)
                : step.op.original
                  ? atomicWrite(fs, step.op.path, step.op.original.bytes, step.op.original.mode)
                  : fs.remove(step.op.path)
            const exit = yield* Effect.exit(undo)
            // Undo newest first, but report in plan order.
            if (Exit.isSuccess(exit)) rolledBack.unshift(step.op.path)
            else rollbackFailed.unshift({ path: step.op.path, reason: reason(exit.cause) })
          }
          for (const dir of [...created].reverse()) {
            yield* Effect.exit(Effect.tryPromise(() => NFS.rmdir(dir)))
          }
          return new CommitError(
            failed,
            done.map((step) => step.op.path),
            rolledBack,
            rollbackFailed,
            remaining.map((step) => step.op.path),
          )
        })

      for (const op of plan.writes) {
        const missing: string[] = []
        let current = path.dirname(op.path)
        while (!created.includes(current) && !(yield* fs.existsSafe(current))) {
          missing.push(current)
          const parent = path.dirname(current)
          if (parent === current) break
          current = parent
        }
        for (const dir of missing.reverse()) {
          const exit = yield* Effect.exit(fs.makeDirectory(dir))
          if (Exit.isFailure(exit)) {
            return yield* Effect.fail(yield* rollback({ path: dir, reason: reason(exit.cause) }, steps))
          }
          created.push(dir)
        }
      }

      for (const [index, step] of steps.entries()) {
        const exit = yield* Effect.exit(
          step.kind === "write"
            ? atomicWrite(fs, step.op.path, step.op.content, step.op.original?.mode)
            : fs.remove(step.op.path),
        )
        if (Exit.isFailure(exit)) {
          return yield* Effect.fail(
            yield* rollback({ path: step.op.path, reason: reason(exit.cause) }, steps.slice(index + 1)),
          )
        }
        done.push(step)
      }

      return {
        written: plan.writes.map((op) => op.path),
        deleted: plan.deletes.map((op) => op.path),
      } satisfies Result
    }),
  )

export * as Transaction from "./transaction"
