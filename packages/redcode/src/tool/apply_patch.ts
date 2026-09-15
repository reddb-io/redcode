import { RepositoryGuard } from "@reddb-io/redcode-core/repository-guard"
import * as path from "path"
import { Cause, Effect, Exit, Schema } from "effect"
import * as Tool from "./tool"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Watcher } from "@reddb-io/redcode-core/filesystem/watcher"
import { InstanceState } from "@/effect/instance-state"
import { Patch } from "../patch"
import { Transaction } from "../patch/transaction"
import { createTwoFilesPatch, diffLines } from "diff"
import { assertExternalDirectoryEffect } from "./external-directory"
import { trimDiff } from "./edit"
import { LSP } from "@/lsp/lsp"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import DESCRIPTION from "./apply_patch.txt"
import { FileSystem } from "@reddb-io/redcode-core/filesystem"
import { Format } from "../format"
import * as Bom from "@/util/bom"

export const Parameters = Schema.Struct({
  patchText: Schema.String.annotate({ description: "The full patch text that describes all changes to be made" }),
})

interface Content {
  readonly text: string
  readonly bom: boolean
}

/** One path's state in the in-memory overlay the whole patch is staged against. */
interface Entry {
  readonly path: string
  /** Where writes land: the resolved symlink target when the file already exists. */
  readonly commitPath: string
  readonly original?: Transaction.Original & { readonly content: Content }
  /** `null` when the path does not exist after the hunks staged so far. */
  next: Content | null
  kind: "add" | "update"
}

interface Change {
  readonly type: "add" | "update" | "delete" | "move"
  readonly filePath: string
  readonly movePath?: string
  readonly before: string
  readonly after: string
  readonly bom: boolean
}

const verificationFailed = (message: string) => Effect.fail(new Error(`apply_patch verification failed: ${message}`))

function applyChunks(filePath: string, chunks: Patch.UpdateFileChunk[], current: Content): Content {
  const crlf = current.text.includes("\r\n")
  const text = crlf ? current.text.replaceAll("\r\n", "\n") : current.text
  const update = Patch.deriveNewContentsFromChunks(filePath, chunks, Bom.join(text, current.bom))
  const next =
    text.length > 0 && !text.endsWith("\n") && update.content.endsWith("\n")
      ? update.content.slice(0, -1)
      : update.content
  return { text: crlf ? next.replaceAll("\n", "\r\n") : next, bom: update.bom }
}

export const ApplyPatchTool = Tool.define(
  "apply_patch",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const afs = yield* FSUtil.Service
    const format = yield* Format.Service
    const events = yield* EventV2Bridge.Service

    const run = Effect.fn("ApplyPatchTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      if (!params.patchText) {
        return yield* Effect.fail(new Error("patchText is required"))
      }

      let hunks: Patch.Hunk[]
      try {
        hunks = Patch.parsePatch(params.patchText).hunks
      } catch (error) {
        return yield* verificationFailed(String(error))
      }

      if (hunks.length === 0) {
        const normalized = params.patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
        if (normalized === "*** Begin Patch\n*** End Patch") {
          return yield* Effect.fail(new Error("patch rejected: empty patch"))
        }
        return yield* verificationFailed("no hunks found")
      }

      const instance = yield* InstanceState.context
      const relative = (file: string) => path.relative(instance.worktree, file).replaceAll("\\", "/")

      // Stage: apply every hunk to an in-memory overlay. Nothing touches disk here.
      const entries = new Map<string, Entry>()
      // Move destination -> the path its content originally came from.
      const origins = new Map<string, string>()

      const guard = (file: string) =>
        Effect.gen(function* () {
          yield* RepositoryGuard.assertWrite(file).pipe(Effect.orDie)
          yield* assertExternalDirectoryEffect(ctx, file)
        })

      const load = (file: string) =>
        Effect.gen(function* () {
          const hit = entries.get(file)
          if (hit) return hit
          const info = yield* afs.stat(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (info && info.type !== "File") return yield* verificationFailed(`${file} is not a file`)
          if (!info) {
            const entry: Entry = { path: file, commitPath: file, next: null, kind: "add" }
            entries.set(file, entry)
            return entry
          }
          const bytes = yield* afs
            .readFile(file)
            .pipe(Effect.catch((error) => verificationFailed(`Failed to read ${file}: ${error.message}`)))
          const content = Bom.split(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes))
          const commitPath = yield* afs.realPath(file).pipe(Effect.catch(() => Effect.succeed(file)))
          const entry: Entry = {
            path: file,
            commitPath,
            original: { bytes, mode: info.mode, content },
            next: content,
            kind: "update",
          }
          entries.set(file, entry)
          return entry
        })

      for (const hunk of hunks) {
        const filePath = path.resolve(instance.directory, hunk.path)
        yield* guard(filePath)
        const entry = yield* load(filePath)

        switch (hunk.type) {
          case "add": {
            const contents =
              hunk.contents.length === 0 || hunk.contents.endsWith("\n") ? hunk.contents : `${hunk.contents}\n`
            entry.next = Bom.split(contents)
            entry.kind = "add"
            origins.delete(filePath)
            break
          }

          case "delete": {
            if (!entry.next) return yield* verificationFailed(`Failed to read file to delete: ${filePath}`)
            entry.next = null
            origins.delete(filePath)
            break
          }

          case "update": {
            if (!entry.next) return yield* verificationFailed(`Failed to read file to update: ${filePath}`)
            let next: Content
            try {
              next = applyChunks(filePath, hunk.chunks, entry.next)
            } catch (error) {
              return yield* verificationFailed(String(error))
            }
            const movePath = hunk.move_path ? path.resolve(instance.directory, hunk.move_path) : undefined
            if (!movePath || movePath === filePath) {
              entry.next = next
              break
            }
            yield* guard(movePath)
            const destination = yield* load(movePath)
            destination.next = next
            destination.kind = "update"
            entry.next = null
            origins.set(movePath, origins.get(filePath) ?? filePath)
            origins.delete(filePath)
            break
          }
        }
      }

      // A path written as a file cannot also be the parent of another written path.
      for (const entry of entries.values()) {
        if (!entry.next) continue
        for (let dir = path.dirname(entry.path); dir !== path.dirname(dir); dir = path.dirname(dir)) {
          if (entries.get(dir)?.next) {
            return yield* verificationFailed(`${entry.path} is inside ${dir}, which this patch writes as a file`)
          }
          if (yield* afs.isDir(dir)) break
        }
      }

      // Describe the net effect per file, folding moves into one change.
      const moves = new Map<string, string>()
      for (const [destination, source] of origins) {
        if (entries.get(destination)?.next && !entries.get(source)?.next && entries.get(source)?.original) {
          moves.set(source, destination)
        }
      }
      const moveDestinations = new Set(moves.values())
      const changes: Change[] = []
      for (const entry of entries.values()) {
        const destination = moves.get(entry.path)
        if (destination) {
          const next = entries.get(destination)!.next!
          changes.push({
            type: "move",
            filePath: entry.path,
            movePath: destination,
            before: entry.original!.content.text,
            after: next.text,
            bom: next.bom,
          })
          continue
        }
        if (moveDestinations.has(entry.path)) continue
        if (!entry.next) {
          if (entry.original) {
            changes.push({
              type: "delete",
              filePath: entry.path,
              before: entry.original.content.text,
              after: "",
              bom: entry.original.content.bom,
            })
          }
          continue
        }
        changes.push({
          type: entry.kind,
          filePath: entry.path,
          before: entry.kind === "add" ? "" : (entry.original?.content.text ?? ""),
          after: entry.next.text,
          bom: entry.next.bom,
        })
      }

      const files = changes.map((change) => {
        const diff = trimDiff(createTwoFilesPatch(change.filePath, change.filePath, change.before, change.after))
        let additions = 0
        let deletions = 0
        if (change.type === "delete") {
          deletions = change.before.split("\n").length
        } else {
          for (const item of diffLines(change.before, change.after)) {
            if (item.added) additions += item.count || 0
            if (item.removed) deletions += item.count || 0
          }
        }
        return {
          filePath: change.filePath,
          relativePath: relative(change.movePath ?? change.filePath),
          type: change.type,
          patch: diff,
          additions,
          deletions,
          ...(change.movePath ? { movePath: change.movePath } : {}),
        }
      })
      const totalDiff = files.map((file) => file.patch + "\n").join("")

      // Approve every path the patch touches, move destinations included, before any write.
      const relativePaths = [...entries.keys()].map(relative)
      yield* ctx.ask({
        permission: "edit",
        patterns: relativePaths,
        always: ["*"],
        metadata: {
          filepath: relativePaths.join(", "),
          diff: totalDiff,
          files,
        },
      })

      // Commit: atomic per file, rolled back as a whole on failure.
      for (const entry of entries.values()) {
        yield* RepositoryGuard.assertWrite(entry.path).pipe(Effect.orDie)
      }
      const encoder = new TextEncoder()
      const plan: Transaction.Plan = {
        writes: [...entries.values()].flatMap((entry) =>
          entry.next
            ? [
                {
                  path: entry.commitPath,
                  content: encoder.encode(Bom.join(entry.next.text, entry.next.bom)),
                  original: entry.original && { bytes: entry.original.bytes, mode: entry.original.mode },
                },
              ]
            : [],
        ),
        deletes: [...entries.values()].flatMap((entry) =>
          !entry.next && entry.original
            ? [{ path: entry.path, original: { bytes: entry.original.bytes, mode: entry.original.mode } }]
            : [],
        ),
      }
      const display = new Map([...entries.values()].map((entry) => [entry.commitPath, entry.path]))
      const shown = (file: string) => relative(display.get(file) ?? file)
      const list = (items: ReadonlyArray<string>) => (items.length ? items.map(shown).join(", ") : "none")

      const committed = yield* Effect.exit(Transaction.commit(afs, plan))
      if (Exit.isFailure(committed)) {
        const error = Cause.squash(committed.cause)
        if (error instanceof Transaction.StaleError) {
          return yield* Effect.fail(
            new Error(
              `apply_patch rejected: ${list(error.paths)} changed on disk after the patch was verified. No files were changed; re-read the files and retry.`,
            ),
          )
        }
        if (error instanceof Transaction.CommitError) {
          const head = `apply_patch failed while committing ${shown(error.failed.path)}: ${error.failed.reason}.`
          if (error.rollbackFailed.length === 0) {
            return yield* Effect.fail(
              new Error(`${head} No files were changed. Rolled back: ${list(error.rolledBack)}.`),
            )
          }
          const stuck = error.rollbackFailed.map((item) => `${shown(item.path)} (${item.reason})`).join(", ")
          return yield* Effect.fail(
            new Error(
              `${head} Rollback incomplete. Rollback failed for: ${stuck}; these files still hold the patched content. Rolled back: ${list(error.rolledBack)}. Not applied: ${list([error.failed.path, ...error.notApplied])}.`,
            ),
          )
        }
        return yield* Effect.failCause(committed.cause)
      }

      const updates: Array<{ file: string; event: "add" | "change" | "unlink" }> = []
      for (const change of changes) {
        switch (change.type) {
          case "add":
            updates.push({ file: change.filePath, event: "add" })
            break
          case "update":
            updates.push({ file: change.filePath, event: "change" })
            break
          case "move":
            updates.push({ file: change.filePath, event: "unlink" })
            updates.push({ file: change.movePath!, event: "add" })
            break
          case "delete":
            updates.push({ file: change.filePath, event: "unlink" })
            break
        }
        if (change.type === "delete") continue
        const edited = change.movePath ?? change.filePath
        if (yield* format.file(edited)) {
          yield* Bom.syncFile(afs, edited, change.bom)
        }
        yield* events.publish(FileSystem.Event.Edited, { file: edited })
      }

      for (const update of updates) {
        yield* events.publish(Watcher.Event.Updated, update)
      }

      const written = changes
        .filter((change) => change.type !== "delete")
        .map((change) => change.movePath ?? change.filePath)
      for (const target of written) {
        yield* lsp.touchFile(target, "document")
      }
      const diagnostics = yield* lsp.diagnostics()

      const summaryLines = changes.map((change) => {
        if (change.type === "add") return `A ${relative(change.filePath)}`
        if (change.type === "delete") return `D ${relative(change.filePath)}`
        if (change.type === "move") return `M ${relative(change.movePath!)} (moved from ${relative(change.filePath)})`
        return `M ${relative(change.filePath)}`
      })
      let output = `Success. Updated the following files:\n${summaryLines.join("\n")}`

      for (const target of written) {
        const block = LSP.Diagnostic.report(target, diagnostics[FSUtil.normalizePath(target)] ?? [])
        if (!block) continue
        output += `\n\nLSP errors detected in ${relative(target)}, please fix:\n${block}`
      }

      return {
        title: output,
        metadata: {
          diff: totalDiff,
          files,
          diagnostics: LSP.Diagnostic.pick(
            diagnostics,
            written.map((target) => FSUtil.normalizePath(target)),
          ),
        },
        output,
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
