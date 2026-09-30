export * as PatchTool from "./patch.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { ToolFailure } from "@opencode/ai"
import { FileDiff } from "@opencode/schema/file-diff"
import { Cause, Effect, Exit, Result, Schema } from "effect"
import { Bom } from "@opencode/util/bom"
import { Bus } from "../../bus.js"
import { Environment } from "../../environment/index.js"
import { FileAccess } from "../../file-access.js"
import { Formatter } from "../../formatter.js"
import { FileMutation } from "../../file-mutation.js"
import type { LSPClient } from "../../lsp/client.js"
import { Diagnostic } from "../../lsp/diagnostic.js"
import { LSP } from "../../lsp/lsp.js"
import { Location } from "../../location.js"
import { Patch } from "@opencode/util/patch"
import { Permission } from "../../permission.js"
import { VaultFiles } from "../../vault/files.js"
import DESCRIPTION from "../patch.txt"
import { fileDiff } from "./file-diff.js"
import { PatchTransaction } from "./patch-transaction.js"

export const name = "patch"

export const Input = Schema.Struct({
  patchText: Schema.String.annotate({
    description: "The full patch text describing add, update, and delete operations",
  }),
})

export const Applied = Schema.Struct({
  type: Schema.Literals(["add", "update", "delete"]),
  resource: Schema.String,
  target: Schema.String,
})

export const Output = Schema.Struct({
  applied: Schema.Array(Applied),
  files: Schema.Array(FileDiff.Info),
})
export type Output = typeof Output.Type

export const toModelContent = (output: Output) =>
  [
    "Success. Updated the following files:",
    ...output.applied.map(
      (item) => `${item.type === "add" ? "A" : item.type === "delete" ? "D" : "M"} ${item.resource}`,
    ),
  ].join("\n")

type Prepared =
  | (Extract<Patch.Hunk, { readonly type: "add" }> & {
      readonly target: FileAccess.Target
      readonly content: string
      readonly before: string
      readonly after: string
    })
  | (Extract<Patch.Hunk, { readonly type: "delete" }> & {
      readonly target: FileAccess.Target
      readonly before: string
      readonly after: string
    })
  | (Extract<Patch.Hunk, { readonly type: "update" }> & {
      readonly target: FileAccess.Target
      readonly content: string
      readonly before: string
      readonly after: string
      readonly moveTarget?: FileAccess.Target
    })

export const Plugin = {
  id: "opencode.tool.patch",
  effect: Effect.fn("PatchTool.Plugin")(function* (ctx: Context) {
    const bus = yield* Bus.Service
    const environment = yield* Environment.Service
    const access = yield* FileAccess.Service
    const fileMutation = yield* FileMutation.Service
    const formatter = yield* Formatter.Service
    const lsp = yield* LSP.Service
    const location = yield* Location.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false, permission: "edit" },
          description: DESCRIPTION,
          input: Input,
          output: Output,
          execute: (input, context) => {
            const applied: Array<typeof Applied.Type> = []
            const parsed = Patch.parse(input.patchText)
            const lockTargets = Result.isSuccess(parsed)
              ? parsed.success.flatMap((hunk) => [
                  FileAccess.resolvePath(location.directory, hunk.path),
                  ...(hunk.type === "update" && hunk.movePath
                    ? [FileAccess.resolvePath(location.directory, hunk.movePath)]
                    : []),
                ])
              : []
            return Effect.gen(function* () {
              const source = {
                type: "tool" as const,
                messageID: context.messageID,
                id: context.id,
              }
              if (!input.patchText) return yield* new ToolFailure({ message: "patchText is required" })
              const hunks = yield* Effect.fromResult(parsed).pipe(
                Effect.mapError((error) => new ToolFailure({ message: `patch verification failed: ${error.message}` })),
              )
              if (hunks.length === 0) {
                return yield* new ToolFailure({ message: "patch rejected: empty patch" })
              }
              const prepared: Prepared[] = []
              // Per written file, whether it receives secrets and which references the patch writes into it.
              const vaulted: Array<{
                readonly resource: string
                readonly secret: boolean
                readonly names: ReadonlyArray<string>
              }> = []
              const staged = new Map<string, string | undefined>()
              const originals = new Map<string, PatchTransaction.Snapshot>()
              const resolveTarget = Effect.fnUntraced(function* (value: string) {
                const target = yield* access.resolve({ path: value, kind: "file" })
                if (target.externalDirectory)
                  yield* access.authorizeExternal([target], context, {
                    filepath: target.absolute,
                    parentDir: target.externalDirectory.directory,
                  })
                if (!originals.has(target.absolute))
                  originals.set(target.absolute, yield* PatchTransaction.snapshot(environment.files, target.absolute))
                return target
              })
              for (const hunk of hunks) {
                yield* Effect.gen(function* () {
                  const target = yield* resolveTarget(hunk.path)
                  if (hunk.type === "add") {
                    const content =
                      hunk.contents.endsWith("\n") || hunk.contents === "" ? hunk.contents : `${hunk.contents}\n`
                    const vault = yield* VaultFiles.mode({
                      environment,
                      root: location.directory,
                      file: target.absolute,
                      written: content,
                      current: "",
                    })
                    vaulted.push({ resource: target.resource, secret: vault.secret, names: vault.names })
                    const written = vault.secret ? yield* VaultFiles.fill(content) : content
                    prepared.push({
                      ...hunk,
                      target,
                      content: written,
                      before: "",
                      after: Bom.split(content).text,
                    })
                    staged.set(target.absolute, written)
                    return
                  }
                  if (hunk.type === "delete") {
                    const content = staged.has(target.absolute)
                      ? staged.get(target.absolute)
                      : yield* FileMutation.readText(environment.files, target.absolute).pipe(
                          Effect.map((result) => Bom.join(result.text, result.bom)),
                          Effect.mapError(
                            (error) =>
                              new ToolFailure({
                                message: `patch verification failed: Failed to delete ${target.resource}: ${errorMessage(error)}`,
                              }),
                          ),
                        )
                    if (content === undefined)
                      return yield* new ToolFailure({
                        message: `patch verification failed: Failed to delete ${target.resource}: file does not exist`,
                      })
                    const clean = yield* VaultFiles.cleaner
                    prepared.push({ ...hunk, target, before: clean(Bom.split(content).text), after: "" })
                    staged.set(target.absolute, undefined)
                    return
                  }
                  const original = staged.has(target.absolute)
                    ? staged.get(target.absolute)
                    : yield* Effect.gen(function* () {
                        const content = yield* FileMutation.readText(environment.files, target.absolute).pipe(
                          Effect.mapError(
                            (error) =>
                              new ToolFailure({
                                message: `patch verification failed: Failed to read file to update ${target.absolute}: ${errorMessage(error)}`,
                              }),
                          ),
                        )
                        return Bom.join(content.text, content.bom)
                      })
                  if (original === undefined)
                    return yield* new ToolFailure({
                      message: `patch verification failed: Failed to read file to update ${target.absolute}: file does not exist`,
                    })
                  const destination = hunk.movePath ? yield* resolveTarget(hunk.movePath) : undefined
                  const moveTarget = destination?.absolute === target.absolute ? undefined : destination
                  // A file meant for secrets is patched in its reference form, the form the model read it in.
                  const vault = yield* VaultFiles.mode({
                    environment,
                    root: location.directory,
                    file: (moveTarget ?? target).absolute,
                    written: JSON.stringify(hunk.chunks),
                    current: original,
                  })
                  vaulted.push({ resource: (moveTarget ?? target).resource, secret: vault.secret, names: vault.names })
                  const base = vault.secret ? vault.clean(original) : original
                  const update = yield* Effect.try({
                    try: () => Patch.derive(hunk.path, hunk.chunks, base),
                    catch: (error) => new ToolFailure({ message: `patch verification failed: ${errorMessage(error)}` }),
                  })
                  const joined = Patch.joinBom(update.content, update.bom)
                  const content = vault.secret ? yield* VaultFiles.fill(joined) : joined
                  prepared.push({
                    ...hunk,
                    target,
                    content,
                    before: vault.clean(Bom.split(base).text),
                    after: vault.clean(update.content),
                    moveTarget,
                  })
                  staged.set(moveTarget?.absolute ?? target.absolute, content)
                  if (moveTarget) staged.set(target.absolute, undefined)
                }).pipe(
                  Effect.mapError((error) =>
                    error instanceof ToolFailure
                      ? error
                      : new ToolFailure({ message: `Unable to prepare patch at ${hunk.path}`, error }),
                  ),
                )
              }

              const patchFiles = prepared.map((change) => patchFile(change))
              const targets = prepared.flatMap((change) => [
                change.target,
                ...(change.type === "update" && change.moveTarget ? [change.moveTarget] : []),
              ])
              yield* permission.assert({
                action: "edit",
                resources: [...new Set(targets.map((target) => target.resource))],
                save: ["*"],
                metadata: {
                  filepath: targets.map((target) => target.resource).join(", "),
                  diff: patchFiles.map((file) => `${file.patch}\n`).join(""),
                  files: patchFiles,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })
              yield* Effect.forEach(
                vaulted.filter((item) => item.secret && item.names.length > 0),
                (item) => VaultFiles.approve({ permission, context, resource: item.resource, names: item.names }),
                { discard: true },
              )

              yield* PatchTransaction.commit(
                environment.files,
                prepared.flatMap((change): PatchTransaction.Operation[] => {
                  if (change.type === "delete") return [{ type: "remove", path: change.target.absolute }]
                  if (change.type === "update" && change.moveTarget)
                    return [
                      { type: "write", path: change.moveTarget.absolute, content: new TextEncoder().encode(change.content) },
                      { type: "remove", path: change.target.absolute },
                    ]
                  return [{ type: "write", path: change.target.absolute, content: new TextEncoder().encode(change.content) }]
                }),
                originals,
              ).pipe(Effect.mapError((error) => new ToolFailure({ message: errorMessage(error) })))
              applied.push(...prepared.map((change) => ({
                type: change.type,
                resource: change.type === "update" && change.moveTarget ? change.moveTarget.resource : change.target.resource,
                target: change.type === "update" && change.moveTarget ? change.moveTarget.absolute : change.target.absolute,
              })))
              const written = applied
                .filter((item) => item.type !== "delete" && staged.get(item.target) !== undefined)
                .filter((item, index, items) => items.findIndex((other) => other.target === item.target) === index)
              const formatted = new Map<string, string>()
              const warnings: string[] = []
              yield* Effect.forEach(
                written,
                (item) =>
                  Effect.gen(function* () {
                    const result = yield* Effect.exit(Effect.gen(function* () {
                      const current = yield* FileMutation.readText(environment.files, item.target)
                      return (yield* formatter.file(item.target))
                        ? yield* FileMutation.syncTextBom(environment.files, item.target, current.bom)
                        : current.text
                    }))
                    if (Exit.isSuccess(result)) {
                      formatted.set(item.target, result.value)
                      return
                    }
                    warnings.push(`Warning: ${item.resource} was patched, but post-patch formatting failed: ${errorMessage(Cause.squash(result.cause))}`)
                    const latest = yield* Effect.exit(FileMutation.readText(environment.files, item.target))
                    if (Exit.isSuccess(latest)) formatted.set(item.target, latest.value.text)
                  }),
                { discard: true },
              )
              const clean = yield* VaultFiles.cleaner
              const files = prepared.map((change) => {
                if (change.type === "delete") return patchFile(change)
                const target = change.type === "update" && change.moveTarget ? change.moveTarget : change.target
                const after = formatted.get(target.absolute)
                return patchFile(change, after === undefined ? undefined : clean(after))
              })
              yield* FileMutation.publishChanges(
                bus,
                [...new Set(prepared.flatMap((change) => [
                  change.target.absolute,
                  ...(change.type === "update" && change.moveTarget ? [change.moveTarget.absolute] : []),
                ]))].flatMap((file) => {
                  const existed = originals.get(file) !== undefined
                  const remains = staged.get(file) !== undefined
                  if (!existed && !remains) return []
                  return [{ file, event: remains ? (existed ? "change" as const : "add" as const) : "unlink" as const }]
                }),
              )
              yield* Effect.forEach(
                written,
                (item) =>
                  lsp.touchFile(item.target, "document").pipe(
                    Effect.catchCause((cause) =>
                      Effect.logWarning("LSP notification failed after patch", { file: item.target, cause }),
                    ),
                  ),
                { discard: true },
              )
              const report = yield* Effect.exit(lsp.diagnostics())
              if (Exit.isFailure(report))
                warnings.push(`Warning: patch applied, but LSP diagnostics were unavailable: ${errorMessage(Cause.squash(report.cause))}`)
              const diagnostics: Record<string, LSPClient.Diagnostic[]> = Exit.isSuccess(report) ? report.value : {}
              const literal = VaultFiles.notice(
                Array.from(new Set(vaulted.flatMap((item) => (item.secret ? [] : item.names)))),
              )
              return { applied, files, written, diagnostics, warnings: literal ? [...warnings, literal] : warnings }
            }).pipe(
              fileMutation.withLock(lockTargets),
              Effect.map((output) => ({
                output: { applied: output.applied, files: output.files },
                content: [
                  toModelContent(output),
                  ...output.written.flatMap((item) => {
                    const report = Diagnostic.report(item.target, output.diagnostics[item.target] ?? [])
                    return report ? [`LSP errors detected in ${item.resource}, please fix:\n${report}`] : []
                  }),
                  ...output.warnings,
                ].join("\n\n"),
                metadata: {
                  files: output.files,
                  diagnostics: Diagnostic.pick(output.diagnostics, output.written.map((item) => item.target)),
                },
              })),
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: "Unable to apply patch", error }),
              ),
            )
          },
        }),
      )
      .pipe(Effect.orDie)

    const hook = (event: SessionHooks["context"]) =>
      Effect.sync(() => {
        const usePatch =
          event.model.id.includes("gpt-") && !event.model.id.includes("oss") && !event.model.id.includes("gpt-4")
        if (usePatch) {
          delete event.tools.edit
          delete event.tools.write
          return
        }
        delete event.tools.patch
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}

function errorMessage(error: unknown) {
  if (error instanceof Environment.NotFound) return "file does not exist"
  if (error instanceof Environment.WrongKind)
    return error.actual === "directory" ? "path is a directory" : `path is ${error.actual}`
  if (error instanceof Environment.Failed) return errorMessage(error.cause)
  return error instanceof Error ? error.message : String(error)
}

function patchFile(change: Prepared, after = change.after): typeof FileDiff.Info.Type {
  const target = (change.type === "update" ? change.moveTarget : undefined)?.resource ?? change.target.resource
  const diff = fileDiff(
    change.target.absolute,
    change.before,
    after,
    change.type === "add" ? "added" : change.type === "delete" ? "deleted" : "modified",
  )
  return {
    ...diff,
    file: target,
    patch: trimDiff(diff.patch),
  }
}

function trimDiff(diff: string) {
  const lines = diff.split("\n")
  const content = lines.filter(
    (line) =>
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++"),
  )
  if (content.length === 0) return diff
  const indent = content.reduce((result, line) => {
    const value = line.slice(1)
    if (value.trim().length === 0) return result
    return Math.min(result, value.match(/^(\s*)/)?.[1].length ?? result)
  }, Infinity)
  if (indent === Infinity || indent === 0) return diff
  return lines
    .map((line) => {
      if (
        (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
        !line.startsWith("---") &&
        !line.startsWith("+++")
      ) {
        return line[0] + line.slice(1 + indent)
      }
      return line
    })
    .join("\n")
}
