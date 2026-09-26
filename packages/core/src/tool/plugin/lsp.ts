export * as LSPTool from "./lsp.js"

import path from "node:path"
import { stat } from "node:fs/promises"
import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { FileAccess } from "../../file-access.js"
import { Location } from "../../location.js"
import { LSP } from "../../lsp/lsp.js"
import { Permission } from "../../permission.js"

export const name = "lsp"
export const Input = Schema.Struct({
  operation: Schema.Literals([
    "goToDefinition",
    "findReferences",
    "hover",
    "documentSymbol",
    "workspaceSymbol",
    "goToImplementation",
    "prepareCallHierarchy",
    "incomingCalls",
    "outgoingCalls",
  ]),
  filePath: Schema.String,
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  character: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  query: Schema.optional(Schema.String),
})

export const Plugin = {
  id: "redcode.tool.lsp",
  effect: Effect.fn("LSPTool.Plugin")(function* (ctx: Context) {
    const lsp = yield* LSP.Service
    const access = yield* FileAccess.Service
    const location = yield* Location.Service
    const permission = yield* Permission.Service

    yield* ctx.tool.transform((editor) => editor.add({
      name,
      options: { codemode: false },
      description:
        "Use a language server to find definitions, references, implementations and symbols, inspect hover information, or trace incoming and outgoing calls. File path may be relative to the current project. Line and character are 1-based. workspaceSymbol uses query to search symbols in active language servers.",
      input: Input,
      output: Schema.Array(Schema.Unknown),
      execute: (input, context) => Effect.gen(function* () {
        const target = yield* access.authorizeRead(input.filePath, context)
        yield* permission.assert({
          action: name,
          resources: ["*"],
          save: ["*"],
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.messageID, id: context.id },
          metadata: { operation: input.operation, filePath: target.absolute },
        })
        const exists = yield* Effect.promise(() => stat(target.absolute).then((info) => info.isFile()).catch(() => false))
        if (!exists) return yield* Effect.fail(new Error(`File not found: ${target.absolute}`))
        if (!(yield* lsp.hasClients(target.absolute)))
          return yield* Effect.fail(new Error("No LSP server available for this file type"))
        const result = yield* lsp.request(input.operation, {
          file: target.absolute,
          line: input.line - 1,
          character: input.character - 1,
          query: input.query,
        })
        const resource = path.relative(location.directory, target.absolute)
        return {
          output: result,
          content: result.length ? JSON.stringify(result, null, 2) : `No results found for ${input.operation}`,
          metadata: { operation: input.operation, filePath: resource, result },
        }
      }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
    })).pipe(Effect.orDie)
  }),
}
