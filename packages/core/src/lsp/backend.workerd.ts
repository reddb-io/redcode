import type { create, Handle } from "./client.js"
import type { LSPServer } from "./server.js"

export function installed(_directory: string, _project: string): LSPServer.Info[] {
  return []
}

export function matches(_server: LSPServer.Info, _file: string) {
  return false
}

export function root(_server: LSPServer.Info, _file: string, _directory: string, _project: string) {
  return Promise.resolve(undefined)
}

export function start(_server: LSPServer.Info, _root: string, _directory: string): Handle {
  throw new Error("Language servers are unavailable on the workerd runtime")
}

export function createClient(_input: Parameters<typeof create>[0]): ReturnType<typeof create> {
  throw new Error("Language servers are unavailable on the workerd runtime")
}
