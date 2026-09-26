/**
 * Model-facing file-write leaf. Relative paths resolve within the active
 * Location. Absolute paths inside that Location are accepted, while explicit
 * absolute external paths retain mutation capability through a separate
 * external_directory approval before edit approval.
 */
export * as WriteTool from "./write.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { Bom } from "@opencode/util/bom"
import { Environment } from "../../environment/index.js"
import { FileMutation } from "../../file-mutation.js"
import { Formatter } from "../../formatter.js"
import { LSP } from "../../lsp/lsp.js"
import { Diagnostic } from "../../lsp/diagnostic.js"
import { FileAccess } from "../../file-access.js"
import { Permission } from "../../permission.js"
import { fileDiff } from "./file-diff.js"

export const name = "write"

// TODO: Revisit whether model-facing mutation schemas should prefer absolute `filePath` naming for trained-in compatibility after evaluating model behavior.
export const Input = Schema.Struct({
  path: Schema.String.annotate({
    description: "Path to the file to write to",
  }),
  content: Schema.String.annotate({ description: "Content to write to the file" }),
})

export const Output = Schema.Struct({
  operation: Schema.Literal("write"),
  target: Schema.String,
  resource: Schema.String,
  existed: Schema.Boolean,
})
export type Output = typeof Output.Type

export const toModelContent = (output: Output) =>
  `${output.existed ? "Wrote" : "Created"} file successfully: ${output.resource}`

/** Deferred write UX integrations remain visible at the model-facing seam. */
// TODO: Publish watcher/file-edit events after watcher integration exists.
// TODO: Add snapshots / undo after design exists.

export const Plugin = {
  id: "opencode.tool.write",
  effect: Effect.fn("WriteTool.Plugin")(function* (ctx: Context) {
    const access = yield* FileAccess.Service
    const fileMutation = yield* FileMutation.Service
    const environment = yield* Environment.Service
    const formatter = yield* Formatter.Service
    const lsp = yield* LSP.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false, permission: "edit" },
          description:
            "Writes a file to the local filesystem, overwriting if one exists.\n\nMissing parent directories are created automatically.\n\nUse this tool to create new files or overwrite existing files. For partial changes, use the edit tool instead.",
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const source = {
                type: "tool" as const,
                messageID: context.messageID,
                id: context.id,
              }
              const target = yield* access.resolve({ path: input.path, kind: "file" })
              yield* access.authorizeExternal([target], context)
              const current = yield* FileMutation.readText(environment.files, target.absolute).pipe(
                Effect.catchTag("Environment.NotFound", () => Effect.undefined),
              )
              const next = Bom.split(input.content)
              const preview = fileDiff(target.resource, current?.text ?? "", next.text, current ? "modified" : "added")
              yield* permission.assert({
                action: "edit",
                resources: [target.resource],
                save: ["*"],
                metadata: { files: [preview] },
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })
              const result = yield* fileMutation.writeTextPreservingBom({ target, content: input.content })
              const bom = (yield* FileMutation.readText(environment.files, target.absolute)).bom
              if (yield* formatter.file(target.absolute)) {
                yield* FileMutation.syncTextBom(environment.files, target.absolute, bom)
              }
              yield* lsp.touchFile(target.absolute, "document").pipe(
                Effect.catchCause((cause) => Effect.logWarning("LSP notification failed after write", { file: target.absolute, cause })),
              )
              const diagnostics = yield* lsp.diagnostics()
              return {
                output: result,
                report: Diagnostic.report(target.absolute, diagnostics[target.absolute] ?? []),
                diagnostics: Diagnostic.pick(diagnostics, [target.absolute]),
              }
            }).pipe(
              Effect.map((result) => ({
                output: result.output,
                content: `${toModelContent(result.output)}${result.report ? `\n\nLSP errors detected in this file, please fix:\n${result.report}` : ""}`,
                metadata: { diagnostics: result.diagnostics },
              })),
              Effect.mapError((error) => new ToolFailure({ message: `Unable to write ${input.path}`, error })),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
