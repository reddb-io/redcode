export * as ExecutionOwnerPlatform from "./execution-owner.node.js"

import os from "node:os"

export const identity = { pid: process.pid, host: os.hostname(), boot: Date.now() - os.uptime() * 1000 }

/** Unknown hosts and permission failures stay owned; a prior local boot cannot own work. */
export function alive(owner: typeof identity, local: boolean) {
  if (owner.host !== identity.host) return true
  if (Math.abs(owner.boot - identity.boot) > 60_000) return false
  if (owner.pid === identity.pid) return local
  try {
    process.kill(owner.pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH")
  }
}
