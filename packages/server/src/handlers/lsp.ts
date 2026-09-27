import { LSP } from "@opencode/core/lsp/lsp"
import { Location } from "@opencode/core/location"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { stat } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const LSPHandler = HttpApiBuilder.group(Api, "server.lsp", (handlers) =>
  handlers
    .handle("lsp.status", () => response(LSP.Service.use((lsp) => lsp.status())))
    .handle("lsp.diagnostics", (ctx) => response(Effect.gen(function* () {
      const location = yield* Location.Service
      const lsp = yield* LSP.Service
      const file = yield* requireFile(location.directory, ctx.query.path)
      yield* lsp.touchFile(file, "full")
      return yield* lsp.diagnostics()
    })))
    .handle("lsp.symbols", (ctx) => response(Effect.gen(function* () {
      const location = yield* Location.Service
      const lsp = yield* LSP.Service
      return yield* lsp.request("workspaceSymbol", {
        file: location.directory,
        line: 0,
        character: 0,
        query: ctx.query.query,
      })
    })))
    .handle("lsp.documentSymbols", (ctx) => response(Effect.gen(function* () {
      const location = yield* Location.Service
      const lsp = yield* LSP.Service
      const file = yield* requireFile(location.directory, ctx.query.path)
      return yield* lsp.request("documentSymbol", { file, line: 0, character: 0 })
    }))),
)

function requireFile(directory: string, target: string) {
  const file = path.resolve(directory, target)
  const relative = path.relative(directory, file)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    return Effect.fail(new InvalidRequestError({ message: "Path escapes the location", field: "path" }))
  return Effect.promise(() => stat(file).then((info) => info.isFile()).catch(() => false)).pipe(
    Effect.flatMap((exists) => exists
      ? Effect.succeed(file)
      : Effect.fail(new InvalidRequestError({ message: `File not found: ${file}`, field: "path" }))),
  )
}
