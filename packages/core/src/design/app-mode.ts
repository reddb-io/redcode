export * as DesignAppMode from "./app-mode.js"

import type { ConfigDesign } from "@opencode/schema/config/design"
import { argv } from "node:process"
import { DesignAppBinary } from "./app-binary.js"

declare const REDCODE_DESIGN_PROCESS_HOST: boolean

/** Published Redcode delegates Design to its app; source checkouts use the configured mode. */
export function process(configured?: ConfigDesign.Effective) {
  // A child serving Design must render locally instead of recursively launching another child.
  if (argv[2] === DesignAppBinary.SUBCOMMAND) return false
  if (typeof REDCODE_DESIGN_PROCESS_HOST !== "undefined" && REDCODE_DESIGN_PROCESS_HOST) return true
  return configured?.app?.mode === "process"
}
