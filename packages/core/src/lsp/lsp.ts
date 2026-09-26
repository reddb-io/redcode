export * as LSP from "./lsp.js"

import path from "node:path"
import { pathToFileURL } from "node:url"
import { Context, Effect, Layer } from "effect"
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
  readonly request: (operation: Operation, position: Position) => Effect.Effect<unknown[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LSP") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const config = yield* Config.Service
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
            } satisfies LSPServer.Info
            if (index < 0) return [...result, server]
            return result.map((item) => item.id === id ? server : item)
          }, defaults)
    const clients = new Map<string, Promise<LSPClient.Info | undefined>>()
    const broken = new Map<string, Status>()
    const active = () => [...clients.values()]
    yield* Effect.addFinalizer(() => Effect.promise(async () => {
      await Promise.all(active().map(async (item) => (await item)?.shutdown()))
    }))

    const get = (file: string) => {
      if (!fileInside(location.directory, file)) return Promise.resolve([])
      return Promise.all(servers.filter((server) => backend.matches(server, file)).map(async (server) => {
        const pending = clients.get(server.id)
        if (pending) return pending
        const started = Promise.resolve().then(async () => {
          const handle = backend.start(server, location.directory)
          return backend.createClient({
              serverID: server.id,
              server: handle,
              root: location.directory,
              directory: location.directory,
            }).then((client) => {
              broken.delete(server.id)
              void handle.exited.then((code) => {
                if (clients.get(server.id) !== started) return
                clients.delete(server.id)
                broken.set(server.id, {
                  id: server.id,
                  root: location.directory,
                  status: "error",
                  error: `Language server exited with code ${code}${client.stderr ? `: ${client.stderr}` : ""}`,
                })
                void client.shutdown().catch(() => undefined)
              })
              return client
            }, (error) => {
              handle.process.kill("SIGTERM")
              throw error
            })
        }).catch((error) => {
          broken.set(server.id, {
            id: server.id,
            root: location.directory,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          })
          return undefined
        })
        clients.set(server.id, started)
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
      return fileInside(location.directory, file) && servers.some((server) => backend.matches(server, file))
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

    const request = Effect.fn("LSP.request")(function* (operation: Operation, position: Position) {
      const matching = operation === "workspaceSymbol"
        ? (yield* Effect.promise(async () => {
            await get(position.file)
            return Promise.all(active())
          })).filter((client): client is LSPClient.Info => client !== undefined)
        : yield* Effect.promise(() => get(position.file))
      const uri = pathToFileURL(position.file).href
      const at = { line: position.line, character: position.character }
      return yield* Effect.promise(() => Promise.all(matching.map(async (client) => {
        if (operation === "workspaceSymbol")
          return client.connection.sendRequest<unknown[]>("workspace/symbol", { query: position.query ?? "" })
        await client.notify.open({ path: position.file })
        if (operation === "documentSymbol")
          return client.connection.sendRequest<unknown[]>("textDocument/documentSymbol", { textDocument: { uri } })
        const item = { textDocument: { uri }, position: at }
        if (operation === "incomingCalls" || operation === "outgoingCalls") {
          const prepared = await client.connection.sendRequest<unknown[]>("textDocument/prepareCallHierarchy", item)
          if (!prepared?.length) return []
          return client.connection.sendRequest<unknown[]>(`callHierarchy/${operation}`, { item: prepared[0] })
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
          : item)
      }).then((result) => result ?? []).catch(() => []))).pipe(
        Effect.map((results) => results.flatMap((result) => Array.isArray(result) ? result : [result])),
      )
    })

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
