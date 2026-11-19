/**
 * Model-facing copy leaf: copies a file or a directory tree byte for byte. It reads the source like the read tool
 * and writes the destination like the write tool, so the same read, edit and external_directory rules apply.
 */
export * as CopyTool from "./copy.js"

import path from "node:path"
import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { Bus } from "../../bus.js"
import { Environment } from "../../environment/index.js"
import { EnvironmentFiles } from "../../environment/files.js"
import { FileAccess } from "../../file-access.js"
import { FileMutation } from "../../file-mutation.js"
import { Permission } from "../../permission.js"

export const name = "copy"

// A copy larger than this is a job for a deliberate command, not an agent's side step.
const MAX_FILES = 2_000
const MAX_BYTES = 200 * 1024 * 1024

export const Input = Schema.Struct({
  source: Schema.String.annotate({ description: "File or directory to copy" }),
  destination: Schema.String.annotate({
    description:
      "Where the copy goes. For a file, the new file's path, or an existing directory (or a path ending in /) to copy it into under its own name. For a directory, the new directory's path.",
  }),
  overwrite: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Replace files that already exist at the destination. Defaults to false.",
  }),
})

export const Output = Schema.Struct({
  operation: Schema.Literal("copy"),
  source: Schema.String,
  destination: Schema.String,
  files: Schema.Number,
  bytes: Schema.Number,
})
export type Output = typeof Output.Type

export const toModelContent = (output: Output) =>
  `Copied ${output.files} ${output.files === 1 ? "file" : "files"} (${output.bytes} bytes) from ${output.source} to ${output.destination}`

export const Plugin = {
  id: "opencode.tool.copy",
  effect: Effect.fn("CopyTool.Plugin")(function* (ctx: Context) {
    const bus = yield* Bus.Service
    const access = yield* FileAccess.Service
    const fileMutation = yield* FileMutation.Service
    const environment = yield* Environment.Service
    const permission = yield* Permission.Service
    const files = environment.files

    const kindOf = (absolute: string) =>
      EnvironmentFiles.typeFollowing(files, absolute).pipe(
        Effect.catchTag("Environment.NotFound", () => Effect.succeed(undefined)),
      )

    // Every file under a directory, skipping links so a copy never leaves the tree it was asked to copy.
    const walk = (directory: string): Effect.Effect<string[], Error> =>
      files.list(directory).pipe(
        Effect.mapError((error) => new Error(`Unable to list ${directory}: ${error._tag}`)),
        Effect.flatMap((entries) =>
          Effect.forEach(entries, (entry) => {
            const absolute = path.join(directory, entry.name)
            if (entry.type === "directory") return walk(absolute)
            return Effect.succeed(entry.type === "file" ? [absolute] : [])
          }),
        ),
        Effect.map((nested) => nested.flat()),
      )

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false, permission: "edit" },
          description:
            "Copies a file or a whole directory, byte for byte, including images and other binary files. Use it to place an existing file somewhere else instead of reading and rewriting it. Missing parent directories are created. Existing files are kept unless overwrite is true. Links inside a copied directory are skipped.",
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const source = {
                type: "tool" as const,
                messageID: context.messageID,
                id: context.id,
              }
              const lexical = yield* access.resolve({ path: input.source })
              const kind = yield* kindOf(lexical.absolute)
              if (kind !== "file" && kind !== "directory")
                return yield* Effect.fail(new Error(`${input.source} is not a file or directory`))
              const from = yield* access.resolve({ path: input.source, kind })
              const into =
                kind === "file" &&
                (/[\\/]$/.test(input.destination) ||
                  (yield* kindOf((yield* access.resolve({ path: input.destination })).absolute)) === "directory")
              const to = yield* access.resolve({
                path: into ? path.join(input.destination, path.basename(from.absolute)) : input.destination,
                kind,
              })
              const relative = path.relative(from.absolute, to.absolute)
              if (
                kind === "directory" &&
                (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)))
              )
                return yield* Effect.fail(new Error("A directory cannot be copied into itself"))

              yield* access.authorizeExternal([from, to], context)
              yield* permission.assert({
                action: "read",
                resources: [from.resource],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })
              yield* permission.assert({
                action: "edit",
                resources: [to.resource],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })

              const sources = kind === "file" ? [from.absolute] : yield* walk(from.absolute)
              if (sources.length > MAX_FILES)
                return yield* Effect.fail(new Error(`${input.source} has more than ${MAX_FILES} files to copy`))
              const plan = yield* Effect.forEach(sources, (file) =>
                Effect.gen(function* () {
                  const target = yield* access.resolve({
                    path: kind === "file" ? to.absolute : path.join(to.absolute, path.relative(from.absolute, file)),
                    kind: "file",
                  })
                  const existing = yield* kindOf(target.absolute)
                  if (existing && !input.overwrite)
                    return yield* Effect.fail(
                      new Error(`${target.resource} already exists; pass overwrite: true to replace it`),
                    )
                  return { file, target, existed: existing !== undefined }
                }),
              )
              const sizes = yield* Effect.forEach(plan, (item) =>
                files.stat(item.file).pipe(Effect.map((info) => info.size)),
              )
              const bytes = sizes.reduce((total, size) => total + size, 0)
              if (bytes > MAX_BYTES)
                return yield* Effect.fail(new Error(`${input.source} is larger than ${MAX_BYTES} bytes to copy`))

              // Every check passed before the first write, so a refused copy leaves the destination untouched.
              yield* Effect.forEach(plan, (item) =>
                files
                  .read(item.file)
                  .pipe(Effect.flatMap((read) => fileMutation.write({ target: item.target, content: read.bytes }))),
              )
              yield* FileMutation.publishChanges(
                bus,
                plan.map((item) => ({ file: item.target.absolute, event: item.existed ? "change" : "add" })),
              )
              return {
                operation: "copy" as const,
                source: from.resource,
                destination: to.resource,
                files: plan.length,
                bytes,
              }
            }).pipe(
              Effect.map((output) => ({ output, content: toModelContent(output) })),
              Effect.mapError(
                (error) =>
                  new ToolFailure({
                    message: `Unable to copy ${input.source} to ${input.destination}${error instanceof Error && error.message ? `: ${error.message}` : ""}`,
                    error,
                  }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
