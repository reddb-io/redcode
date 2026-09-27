export * as LSP from "./lsp.js"

import path from "node:path"
import { pathToFileURL } from "node:url"
import { Context, Effect, Layer } from "effect"
import { CancellationTokenSource } from "vscode-jsonrpc/node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import type { Info } from "@opencode/schema/config"
import { Config } from "../config.js"
import { Location } from "../location.js"
import type { LSPClient } from "./client.js"
import type { LSPServer } from "./server.js"

export type Operation =
  | "goToDefinition"
  | "findReferences"
  | "hover"
  | "documentSymbol"
  | "workspaceSymbol"
  | "goToImplementation"
  | "prepareCallHierarchy"
  | "incomingCalls"
  | "outgoingCalls"

export interface Position {
  readonly file: string
  readonly line: number
  readonly character: number
  readonly query?: string
}

export interface Status {
  readonly id: string
  readonly root: string
  readonly status: "connected" | "error"
  readonly error?: string
}

export interface Interface {
  readonly status: () => Effect.Effect<Status[]>
  readonly hasClients: (file: string) => Effect.Effect<boolean>
  readonly touchFile: (file: string, diagnostics?: "document" | "full") => Effect.Effect<void>
  readonly diagnostics: () => Effect.Effect<Record<string, LSPClient.Diagnostic[]>>
  readonly request: (operation: Operation, position: Position, abort?: AbortSignal) => Effect.Effect<unknown[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LSP") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const config = yield* Config.Service
    const downloads = !["1", "true"].includes(process.env["REDCODE_DISABLE_LSP_DOWNLOAD"]?.toLowerCase() ?? "")
    const backend = yield* Effect.promise(() => import("#lsp"))
    const entries = yield* config.entries()
    const selected = entries.reduce<Info["lsp"]>((value, entry) => {
      if (entry.type !== "document" || entry.info.lsp === undefined) return value
      if (typeof entry.info.lsp === "boolean") return entry.info.lsp
      if (value === undefined || typeof value === "boolean") return entry.info.lsp
      return { ...value, ...entry.info.lsp }
    }, undefined)
    const defaults = backend.installed(location.directory, location.project.directory)
    const servers = selected === false
      ? []
      : selected === undefined || selected === true
        ? defaults
        : Object.entries(selected).reduce<LSPServer.Info[]>((result, [id, entry]) => {
            const index = result.findIndex((server) => server.id === id)
            if (!("command" in entry) || entry.disabled) return result.filter((server) => server.id !== id)
            const existing = index < 0 ? undefined : result[index]
            const server = {
              id,
              command: entry.command,
              extensions: entry.extensions ?? existing?.extensions ?? [],
              env: entry.env,
              initialization: entry.initialization,
              root: existing?.root,
            } satisfies LSPServer.Info
            if (index < 0) return [...result, server]
            return result.map((item) => item.id === id ? server : item)
          }, defaults)
    const clients = new Map<string, Promise<LSPClient.Info | undefined>>()
    const broken = new Map<string, Status>()
    const failedAt = new Map<string, number>()
    const used = new Map<string, number>()
    const ready = new Set<string>()
    let sequence = 0
    const configuredLimit = Number(process.env["REDCODE_LSP_MAX_CLIENTS"])
    const limit = Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 8
    const active = () => [...clients.values()]
    const available = (key: string) => {
      if (!broken.has(key)) return true
      if (Date.now() - (failedAt.get(key) ?? 0) < 30_000) return false
      broken.delete(key)
      failedAt.delete(key)
      return true
    }
    const evict = (keep: string) => {
      while (clients.size > limit) {
        const key = [...clients.keys()]
          .filter((item) => item !== keep && ready.has(item))
          .sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0]
        if (!key) return
        const client = clients.get(key)
        clients.delete(key)
        used.delete(key)
        ready.delete(key)
        void client?.then((item) => item?.shutdown()).catch(() => undefined)
      }
    }
    yield* Effect.addFinalizer(() => Effect.promise(async () => {
      await Promise.all(active().map(async (item) => (await item)?.shutdown()))
    }))

    const get = async (file: string) => {
      if (!fileInside(location.directory, file)) return []
      const matching = await Promise.all(servers.filter((server) => backend.matches(server, file)).map(async (server) => ({
        server,
        root: await backend.root(server, file, location.directory, location.project.directory),
      })))
      return Promise.all(matching.filter((item): item is { server: LSPServer.Info; root: string } =>
        item.root !== undefined && backend.available(item.server, item.root, location.directory, downloads),
      ).map(async ({ server, root }) => {
        const key = `${server.id}\0${root}`
        if (!available(key)) return undefined
        const pending = clients.get(key)
        if (pending) {
          used.set(key, ++sequence)
          return pending
        }
        const started = Promise.resolve().then(async () => {
          const handle = await backend.start(server, root, location.directory, downloads)
          return backend.createClient({
              serverID: server.id,
              server: handle,
              root,
              directory: location.directory,
            }).then((client) => {
              if (clients.get(key) !== started) return client
              broken.delete(key)
              failedAt.delete(key)
              ready.add(key)
              used.set(key, ++sequence)
              evict(key)
              void handle.exited.then((code) => {
                if (clients.get(key) !== started) return
                clients.delete(key)
                used.delete(key)
                ready.delete(key)
                broken.set(key, {
                  id: server.id,
                  root,
                  status: "error",
                  error: `Language server exited with code ${code}${client.stderr ? `: ${client.stderr}` : ""}`,
                })
                failedAt.set(key, Date.now())
                void client.shutdown().catch(() => undefined)
              })
              return client
            }, (error) => {
              handle.process.kill("SIGTERM")
              throw error
            })
        }).catch((error) => {
          if (clients.get(key) !== started) return undefined
          clients.delete(key)
          used.delete(key)
          ready.delete(key)
          broken.set(key, {
            id: server.id,
            root,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          })
          failedAt.set(key, Date.now())
          return undefined
        })
        clients.set(key, started)
        used.set(key, ++sequence)
        return started
      })).then((items) => items.filter((item): item is LSPClient.Info => item !== undefined))
    }

    const status = Effect.fn("LSP.status")(function* () {
      const running = yield* Effect.promise(() => Promise.all(active()))
      return [
        ...running.flatMap((client): Status[] => client ? [{ id: client.serverID, root: client.root, status: "connected" }] : []),
        ...broken.values(),
      ]
    })

    const hasClients = Effect.fn("LSP.hasClients")(function* (file: string) {
      if (!fileInside(location.directory, file)) return false
      const roots = yield* Effect.promise(() => Promise.all(servers.filter((server) => backend.matches(server, file)).map((server) =>
        backend.root(server, file, location.directory, location.project.directory).then((root) =>
          root && backend.available(server, root, location.directory, downloads) && available(`${server.id}\0${root}`) ? root : undefined,
        ),
      )))
      return roots.some((root) => root !== undefined)
    })

    const touchFile = Effect.fn("LSP.touchFile")(function* (file: string, diagnostics?: "document" | "full") {
      const matching = yield* Effect.promise(() => get(file))
      yield* Effect.promise(() => Promise.all(matching.map(async (client) => {
        const after = Date.now()
        const version = await client.notify.open({ path: file })
        if (diagnostics) await client.waitForDiagnostics({ path: file, version, mode: diagnostics, after })
      })).then(() => undefined))
    })

    const diagnostics = Effect.fn("LSP.diagnostics")(function* () {
      const running = yield* Effect.promise(() => Promise.all(active()))
      return running.reduce<Record<string, LSPClient.Diagnostic[]>>((result, client) => {
        client?.diagnostics.forEach((issues, file) => { result[file] = [...(result[file] ?? []), ...issues] })
        return result
      }, {})
    })

    const request = Effect.fn("LSP.request")((operation: Operation, position: Position, abort?: AbortSignal) =>
      Effect.promise(async () => {
        const cancellation = new CancellationTokenSource()
        const stop = () => cancellation.cancel()
        abort?.addEventListener("abort", stop, { once: true })
        if (abort?.aborted) stop()
        try {
          if (operation === "workspaceSymbol") await get(position.file)
          const matching = operation === "workspaceSymbol"
            ? (await Promise.all(active())).filter((client): client is LSPClient.Info => client !== undefined)
            : await get(position.file)
          if (abort?.aborted) return []
          const uri = pathToFileURL(position.file).href
          const at = { line: position.line, character: position.character }
          const results = await Promise.all(matching.map((client) => (async () => {
            if (operation === "workspaceSymbol")
              return client.connection.sendRequest<unknown[]>(
                "workspace/symbol", { query: position.query ?? "" }, cancellation.token,
              )
            await client.notify.open({ path: position.file })
            if (abort?.aborted) return []
            if (operation === "documentSymbol")
              return client.connection.sendRequest<unknown[]>(
                "textDocument/documentSymbol", { textDocument: { uri } }, cancellation.token,
              )
            const item = { textDocument: { uri }, position: at }
            if (operation === "incomingCalls" || operation === "outgoingCalls") {
              const prepared = await client.connection.sendRequest<unknown[]>(
                "textDocument/prepareCallHierarchy", item, cancellation.token,
              )
              if (!prepared?.length || abort?.aborted) return []
              return client.connection.sendRequest<unknown[]>(
                `callHierarchy/${operation}`, { item: prepared[0] }, cancellation.token,
              )
            }
            const method = {
              goToDefinition: "textDocument/definition",
              findReferences: "textDocument/references",
              hover: "textDocument/hover",
              goToImplementation: "textDocument/implementation",
              prepareCallHierarchy: "textDocument/prepareCallHierarchy",
            }[operation]
            return client.connection.sendRequest<unknown>(method, operation === "findReferences"
              ? { ...item, context: { includeDeclaration: true } }
              : item, cancellation.token)
          })().then((result) => result ?? []).catch(() => [])))
          return results.flatMap((result) => Array.isArray(result) ? result : [result])
        } finally {
          abort?.removeEventListener("abort", stop)
          cancellation.dispose()
        }
      }),
    )

    return Service.of({ status, hasClients, touchFile, diagnostics, request })
  }),
)

function fileInside(directory: string, file: string) {
  const relative = path.relative(directory, file)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, Location.node],
})
