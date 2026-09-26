export * as UsagePath from "./path.js"

import { resolve } from "#usage-sidecar"

export function sidecar(home: string) {
  return resolve(process.env.REDCODE_TEST_HOME ?? home)
}

export function enabled() {
  const flag = process.env.REDCODE_DISABLE_USAGE_SIDECAR?.toLowerCase()
  return flag !== "1" && flag !== "true"
}
