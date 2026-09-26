export * as DesignViewports from "./viewports.js"

import { viewports } from "./ui/viewports.js"
import type { Design } from "@opencode/schema/design"
import type { ConfigDesign } from "@opencode/schema/config/design"

/**
 * The viewports one document is audited, compared and verified at, under the configured web
 * breakpoints. The definition itself is shared with the review page; see `viewports`.
 */
export function of(
  document: Pick<Design.Info, "target" | "platform">,
  config: Pick<ConfigDesign.Effective, "breakpoints"> | undefined,
) {
  return viewports(document.target, document.platform, { breakpoints: config?.breakpoints })
}
