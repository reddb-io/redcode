export * as DesignViewports from "./viewports"

import { viewports } from "@reddb-io/redcode-design/viewports"
import type { Design } from "@reddb-io/redcode-schema/design"
import type { ConfigDesign } from "../config/design"

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
