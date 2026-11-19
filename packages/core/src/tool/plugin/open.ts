/**
 * Model-facing open leaf: shows the user a file or directory in the application their system uses for it, on the
 * machine running Redcode. It never runs programs: executables and scripts are refused, because opening one runs it.
 */
export * as OpenTool from "./open.js"

import path from "node:path"
import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { BrowserDisabledError, openPath } from "@opencode/util/open"
import { Effect, Schema } from "effect"
import { Environment } from "../../environment/index.js"
import { EnvironmentFiles } from "../../environment/files.js"
import { FileAccess } from "../../file-access.js"
import { Permission } from "../../permission.js"

export const name = "open"

// Files whose default action on Windows, macOS or Linux is to execute them.
const EXECUTABLE =
  /\.(exe|com|bat|cmd|ps1|psm1|psd1|vbs|vbe|js|jse|wsf|wsh|hta|msi|msp|msix|appx|scr|cpl|lnk|url|reg|jar|app|command|tool|sh|bash|zsh|fish|csh|desktop|appimage|run|bin|py|pyw|pl|rb|php)$/i

export const Input = Schema.Struct({
  path: Schema.String.annotate({ description: "File or directory to open for the user" }),
})

export const Output = Schema.Struct({
  operation: Schema.Literal("open"),
  resource: Schema.String,
  kind: Schema.Literals(["file", "directory"]),
})
export type Output = typeof Output.Type

export const toModelContent = (output: Output) =>
  `Opened ${output.kind === "directory" ? "directory" : "file"} for the user: ${output.resource}`

export const Plugin = {
  id: "opencode.tool.open",
  effect: Effect.fn("OpenTool.Plugin")(function* (ctx: Context) {
    const access = yield* FileAccess.Service
    const environment = yield* Environment.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            "Opens a file or directory for the user in the application their system uses for it (a directory opens in the file manager), on the machine running Redcode. Use it when the user wants to see or use a file or folder outside the conversation, such as an exported deck, an image or the folder that holds them. It does not run programs: executables and scripts are refused. The user may be asked to approve it.",
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const lexical = yield* access.resolve({ path: input.path })
              const kind = yield* EnvironmentFiles.typeFollowing(environment.files, lexical.absolute).pipe(
                Effect.catchTag("Environment.NotFound", () => Effect.succeed(undefined)),
              )
              if (kind !== "file" && kind !== "directory")
                return yield* Effect.fail(new Error(`${input.path} is not a file or directory`))
              if (kind === "file" && EXECUTABLE.test(path.basename(lexical.absolute)))
                return yield* Effect.fail(
                  new Error(
                    `${input.path} is a program or script, which opening would run; tell the user where it is instead`,
                  ),
                )
              const target = yield* access.resolve({ path: input.path, kind })
              yield* access.authorizeExternal([target], context)
              yield* permission.assert({
                action: "open",
                resources: [target.resource],
                save: [target.resource],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              yield* Effect.tryPromise({
                try: () => openPath(target.absolute),
                catch: (error) =>
                  error instanceof BrowserDisabledError
                    ? new Error(`Opening files is disabled on this host; the path is ${target.absolute}`)
                    : new Error(`The system could not open ${target.absolute}`),
              })
              return { operation: "open" as const, resource: target.resource, kind }
            }).pipe(
              Effect.map((output) => ({ output, content: toModelContent(output) })),
              Effect.mapError(
                (error) =>
                  new ToolFailure({
                    message: `Unable to open ${input.path}${error instanceof Error && error.message ? `: ${error.message}` : ""}`,
                    error,
                  }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
