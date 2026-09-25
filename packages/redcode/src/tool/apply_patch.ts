import { RepositoryGuard } from "@reddb-io/redcode-core/repository-guard"
import * as path from "path"
import { Cause, Effect, Exit, Option, Schema } from "effect"
import { Config } from "@/config/config"
import * as Tool from "./tool"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Watcher } from "@reddb-io/redcode-core/filesystem/watcher"
import { InstanceState } from "@/effect/instance-state"
import { Patch } from "../patch"
import { Transaction } from "../patch/transaction"
import { createTwoFilesPatch, diffArrays, diffLines } from "diff"
import { assertExternalDirectoryEffect } from "./external-directory"
import { trimDiff } from "./edit"
import { LSP } from "@/lsp/lsp"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import DESCRIPTION from "./apply_patch.txt"
import { FileSystem } from "@reddb-io/redcode-core/filesystem"
import { Format } from "../format"
import * as Bom from "@/util/bom"
import { Session } from "@/session/session"
import { AutoWorktree } from "@/session/auto-worktree"

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
  /** Where writes land: the path with every symlink resolved (for a new file, through its nearest existing parent). */
  readonly commitPath: string
  /** Where a delete lands: the resolved parent directory plus the entry's own name. */
  readonly location: string
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
  /** Previous content of an existing file this change overwrites (an Add File or a move destination). */
  readonly replaces?: string
}

const verificationFailed = (message: string) => Effect.fail(new Error(`apply_patch verification failed: ${message}`))

/**
 * Re-applies the original line endings to an LF-normalized update. Lines the patch kept retain their own
 * ending; lines it added use the file's dominant ending.
 */
function restoreLineEndings(original: string, updated: string) {
  const parts = original.split("\n")
  const endings = parts.map((part, index) => (index === parts.length - 1 ? "" : part.endsWith("\r") ? "\r\n" : "\n"))
  const crlf = endings.filter((ending) => ending === "\r\n").length
  if (crlf === 0) return updated
  const dominant = crlf > endings.filter((ending) => ending === "\n").length ? "\r\n" : "\n"
  const lines = parts.map((part, index) => (endings[index] === "\r\n" ? part.slice(0, -1) : part))
  const next = updated.split("\n")
  let oldIndex = 0
  let newIndex = 0
  let output = ""
  for (const change of diffArrays(lines, next)) {
    for (const value of change.value) {
      if (change.removed) {
        oldIndex++
        continue
      }
      const ending = newIndex === next.length - 1 ? "" : change.added ? dominant : endings[oldIndex] || dominant
      output += value + ending
      if (!change.added) oldIndex++
      newIndex++
    }
  }
  return output
}

function applyChunks(filePath: string, chunks: Patch.UpdateFileChunk[], current: Content): Content {
  const crlf = current.text.includes("\r\n")
  const text = crlf ? current.text.replaceAll("\r\n", "\n") : current.text
  const update = Patch.deriveNewContentsFromChunks(filePath, chunks, Bom.join(text, current.bom))
  const next =
    text.length > 0 && !text.endsWith("\n") && update.content.endsWith("\n")
      ? update.content.slice(0, -1)
      : update.content
  return { text: crlf ? restoreLineEndings(current.text, next) : next, bom: update.bom }
}

export const ApplyPatchTool = Tool.define(
  "apply_patch",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const afs = yield* FSUtil.Service
    const format = yield* Format.Service
    const events = yield* EventV2Bridge.Service
    const sessions = yield* Session.Service
    // Optional so the tool still builds where no config is provided; the registry always has one.
    const config = Option.getOrUndefined(yield* Effect.serviceOption(Config.Service))

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

      // Symlinks are resolved before any check, so a link cannot carry a write outside the
      // project or into Git metadata without the same guard and approval as the real path.
      const realPath = (file: string) => afs.realPath(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
      const resolveTarget = (file: string) =>
        Effect.gen(function* () {
          const rest: string[] = []
          let current = file
          while (true) {
            const real = yield* realPath(current)
            if (real !== undefined) return path.join(real, ...rest)
            const parent = path.dirname(current)
            if (parent === current) return file
            rest.unshift(path.basename(current))
            current = parent
          }
        })
      const realDirectory = (yield* realPath(instance.directory)) ?? instance.directory
      const realWorktree = instance.worktree === "/" ? "/" : ((yield* realPath(instance.worktree)) ?? instance.worktree)
      // Express a resolved path through the instance's own spelling when it lies inside it.
      const logical = (resolved: string) => {
        if (FSUtil.contains(realDirectory, resolved)) {
          return path.join(instance.directory, path.relative(realDirectory, resolved))
        }
        if (realWorktree !== "/" && FSUtil.contains(realWorktree, resolved)) {
          return path.join(instance.worktree, path.relative(realWorktree, resolved))
        }
        return resolved
      }
      const guard = (resolved: string) =>
        Effect.gen(function* () {
          yield* RepositoryGuard.assertWrite(resolved).pipe(Effect.orDie)
          yield* assertExternalDirectoryEffect(ctx, logical(resolved))
        })

      // Stage: apply every hunk to an in-memory overlay. Nothing touches disk here.
      const entries = new Map<string, Entry>()
      const claims = new Map<string, string>()
      // Move destination -> the path its content originally came from.
      const origins = new Map<string, string>()

      const load = (file: string) =>
        Effect.gen(function* () {
          const hit = entries.get(file)
          if (hit) return hit
          const commitPath = yield* resolveTarget(file)
          const location = path.join(yield* resolveTarget(path.dirname(file)), path.basename(file))
          for (const target of new Set([commitPath, location])) yield* guard(target)
          const claimed = claims.get(commitPath)
          if (claimed !== undefined) {
            return yield* verificationFailed(
              `${relative(file)} and ${relative(claimed)} resolve to the same file (${commitPath}); patch it through one path`,
            )
          }
          claims.set(commitPath, file)

          const info = yield* afs.stat(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (info && info.type !== "File") return yield* verificationFailed(`${file} is not a file`)
          if (!info) {
            const entry: Entry = { path: file, commitPath, location, next: null, kind: "add" }
            entries.set(file, entry)
            return entry
          }
          const bytes = yield* afs
            .readFile(file)
            .pipe(Effect.catch((error) => verificationFailed(`Failed to read ${file}: ${error.message}`)))
          const content = Bom.split(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes))
          const link = yield* afs.readLink(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
          const entry: Entry = {
            path: file,
            commitPath,
            location,
            original: { bytes, mode: info.mode, link, content },
            next: content,
            kind: "update",
          }
          entries.set(file, entry)
          return entry
        })

      // A patch against the primary checkout lands in the session worktree, created on first use.
      const place = (file: string) =>
        AutoWorktree.route(
          { sessions, events, config, sessionID: ctx.sessionID, agent: ctx.agent },
          path.resolve(instance.directory, file),
        )

      for (const hunk of hunks) {
        const filePath = yield* place(hunk.path)
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
            const movePath = hunk.move_path ? yield* place(hunk.move_path) : undefined
            if (!movePath || movePath === filePath) {
              entry.next = next
              break
            }
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
          const target = entries.get(destination)!
          changes.push({
            type: "move",
            filePath: entry.path,
            movePath: destination,
            before: entry.original!.content.text,
            after: target.next!.text,
            bom: target.next!.bom,
            replaces: target.original?.content.text,
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
          before: entry.original?.content.text ?? "",
          after: entry.next.text,
          bom: entry.next.bom,
          replaces: entry.kind === "add" ? entry.original?.content.text : undefined,
        })
      }

      const REPLACED = "existing file (replaced)"
      const files = changes.map((change) => {
        let diff = trimDiff(
          change.type === "add" && change.replaces !== undefined
            ? createTwoFilesPatch(change.filePath, change.filePath, change.before, change.after, REPLACED)
            : createTwoFilesPatch(change.filePath, change.filePath, change.before, change.after),
        )
        if (change.type === "move" && change.replaces !== undefined) {
          diff += `\n${trimDiff(createTwoFilesPatch(change.movePath!, change.movePath!, change.replaces, change.after, REPLACED))}`
        }
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
          ...(change.replaces !== undefined ? { replaced: true } : {}),
        }
      })
      const totalDiff = files.map((file) => file.patch + "\n").join("")

      // Approve every path the patch touches, move destinations and symlink targets included, before any write.
      const relativePaths = [
        ...new Set(
          [...entries.values()].flatMap((entry) => [
            relative(entry.path),
            relative(logical(entry.commitPath)),
            relative(logical(entry.location)),
          ]),
        ),
      ]
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
        for (const target of new Set([entry.commitPath, entry.location])) {
          yield* RepositoryGuard.assertWrite(target).pipe(Effect.orDie)
        }
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
            ? [
                {
                  path: entry.location,
                  original: { bytes: entry.original.bytes, mode: entry.original.mode, link: entry.original.link },
                },
              ]
            : [],
        ),
      }
      const display = new Map(
        [...entries.values()].flatMap((entry) => [
          [entry.commitPath, entry.path] as const,
          [entry.location, entry.path] as const,
        ]),
      )
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

      // The patch is on disk from here on: follow-up problems are warnings, not failures.
      const warnings: string[] = []
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
          const synced = yield* Effect.exit(Bom.syncFile(afs, edited, change.bom))
          if (Exit.isFailure(synced)) {
            const cause = Cause.squash(synced.cause)
            warnings.push(
              `Warning: ${relative(edited)} was patched, but restoring its byte order mark after formatting failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            )
          }
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
        const replaced = change.replaces !== undefined ? "replaced existing file" : undefined
        if (change.type === "add") return `A ${relative(change.filePath)}${replaced ? ` (${replaced})` : ""}`
        if (change.type === "delete") return `D ${relative(change.filePath)}`
        if (change.type === "move") {
          const notes = [`moved from ${relative(change.filePath)}`, replaced].filter(Boolean).join(", ")
          return `M ${relative(change.movePath!)} (${notes})`
        }
        return `M ${relative(change.filePath)}`
      })
      let output = `Success. Updated the following files:\n${summaryLines.join("\n")}`
      if (warnings.length) output += `\n\n${warnings.join("\n")}`

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
