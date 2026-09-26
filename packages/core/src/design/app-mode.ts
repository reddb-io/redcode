export * as DesignAppMode from "./app-mode.js"

import type { ConfigDesign } from "@opencode/schema/config/design"

declare const REDCODE_DESIGN_PROCESS_HOST: boolean

/** Published Redcode delegates Design to its app; source checkouts use the configured mode. */
export function process(configured?: ConfigDesign.Effective) {
  if (typeof REDCODE_DESIGN_PROCESS_HOST !== "undefined" && REDCODE_DESIGN_PROCESS_HOST) return true
  return configured?.app?.mode === "process"
}
