import type { Store } from "./sidecar.js"

export const supported = false

export function open(_filename: string): Store {
  throw new Error("Usage sidecar requires a local filesystem")
}
