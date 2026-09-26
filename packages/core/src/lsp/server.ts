export * as LSPServer from "./server.js"

import { spawn } from "node:child_process"
import path from "node:path"
import { which } from "../util/which.js"
import type { Handle } from "./client.js"

export interface Info {
  readonly id: string
  readonly extensions: readonly string[]
  readonly command: readonly string[]
  readonly initialization?: Record<string, unknown>
  readonly env?: Record<string, string>
}

/** Resolve installed servers in PATH and the current project's package bins. */
export function installed(directory: string, project: string): Info[] {
  const bins = [...new Set([directory, project])].map((root) => path.join(root, "node_modules", ".bin")).join(path.delimiter)
  return ([
    { id: "typescript", command: ["typescript-language-server", "--stdio"], extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"] },
    { id: "rust-analyzer", command: ["rust-analyzer"], extensions: [".rs"] },
    { id: "gopls", command: ["gopls"], extensions: [".go"] },
    { id: "pyright", command: ["pyright-langserver", "--stdio"], extensions: [".py"] },
    { id: "clangd", command: ["clangd", "--background-index"], extensions: [".c", ".h", ".cpp", ".cc", ".cxx", ".hpp"] },
  ] satisfies Info[]).flatMap((server) => {
    const executable = which(server.command[0], undefined, bins)
    return executable ? [{ ...server, command: [executable, ...server.command.slice(1)] }] : []
  })
}

export function matches(server: Info, file: string) {
  return server.extensions.length === 0 || server.extensions.includes(path.extname(file).toLowerCase())
}

export function start(server: Info, root: string): Handle {
  if (!server.command.length) throw new Error(`LSP server ${server.id} has no command`)
  const process = spawn(server.command[0], server.command.slice(1), {
    cwd: root,
    env: { ...globalThis.process.env, ...server.env },
    stdio: "pipe",
  })
  const exited = new Promise<number | null>((resolve, reject) => {
    process.once("error", reject)
    process.once("exit", resolve)
  })
  process.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE" || error.code === "ECONNRESET") return
    process.kill("SIGTERM")
  })
  return { process, exited, initialization: server.initialization }
}
