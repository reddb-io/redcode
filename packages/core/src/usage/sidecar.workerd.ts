import type { Store } from "./sidecar.js"

export const supported = false

export function resolve(home: string) {
  return `${home}/.red/code/data/usage/opencode.db`
}

export function open(_filename: string): Store {
  throw new Error("Usage sidecar requires a local filesystem")
}
