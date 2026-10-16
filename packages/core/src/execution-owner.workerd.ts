export * as ExecutionOwnerPlatform from "./execution-owner.workerd.js"

export const identity = { pid: 0, host: crypto.randomUUID(), boot: 0 }

// Durable Object storage has one owning object across isolates. A replacement
// isolate may reclaim the previous isolate's tokens without OS process APIs.
export function alive(owner: typeof identity, local: boolean) {
  return owner.host === identity.host && local
}
