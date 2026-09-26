export * as UsagePath from "./path.js"

import { existsSync } from "node:fs"
import path from "node:path"

export function sidecar(home: string) {
  const base = process.env.REDCODE_TEST_HOME ?? home
  const preferred = path.join(base, ".red", "code", "data", "usage", "opencode.db")
  const legacy = path.join(base, ".red", "redcode", "data", "usage", "opencode.db")
  return existsSync(path.dirname(preferred)) || !existsSync(path.dirname(legacy)) ? preferred : legacy
}

export function enabled() {
  const flag = process.env.REDCODE_DISABLE_USAGE_SIDECAR?.toLowerCase()
  return flag !== "1" && flag !== "true"
}
