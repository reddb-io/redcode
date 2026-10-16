export * as RemoteAccessHost from "./remote-access"

import type { RemoteAccess } from "@opencode/schema/remote-access"

/** The listener owner supplies tunnel lifecycle control; embedders can leave it unavailable. */
export interface Interface {
  readonly status: () => RemoteAccess.Status
  readonly configure: (input: RemoteAccess.Configure) => Promise<RemoteAccess.Status>
  readonly disable: () => Promise<RemoteAccess.Status>
}
