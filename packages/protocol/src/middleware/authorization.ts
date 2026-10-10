import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { UnauthorizedError } from "../errors.js"
import { ConsoleForbiddenError } from "../console.js"
import { ServerAccess } from "../server-access.js"

export class Authorization extends HttpApiMiddleware.Service<Authorization, { provides: ServerAccess.Current }>()(
  "@opencode/HttpApiAuthorization",
  {
    error: [UnauthorizedError, ConsoleForbiddenError],
  },
) {}
