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
      const file = path.resolve(location.directory, ctx.query.path)
      const relative = path.relative(location.directory, file)
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        return yield* new InvalidRequestError({ message: "Path escapes the location", field: "path" })
      const exists = yield* Effect.promise(() => stat(file).then((info) => info.isFile()).catch(() => false))
      if (!exists) return yield* new InvalidRequestError({ message: `File not found: ${file}`, field: "path" })
      yield* lsp.touchFile(file, "full")
      return yield* lsp.diagnostics()
    }))),
)
