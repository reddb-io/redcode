import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { ConflictError } from "../errors.js"

/** Guards mutating Session requests, including permissions and forms, on managed workers. */
export class WorkerFencing extends HttpApiMiddleware.Service<WorkerFencing>()("@opencode/HttpApiWorkerFencing", {
  error: [ConflictError],
}) {}
