import { LSP } from "@opencode/core/lsp/lsp"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const LSPHandler = HttpApiBuilder.group(Api, "server.lsp", (handlers) =>
  handlers.handle("lsp.status", () => response(LSP.Service.use((lsp) => lsp.status()))),
)
