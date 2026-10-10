export * as ServerAccess from "./server-access.js"

import { Context } from "effect"
import type { Infrastructure } from "@opencode/schema/infrastructure"

export interface Principal {
  readonly token: string
  readonly access: Infrastructure.Access
}
// Undefined is the trusted local/server credential path. Console users always carry a verified principal.
export class Current extends Context.Service<Current, Principal | undefined>()("@redcode/ServerAccess") {}
