import { NamedError } from "@reddb-io/redcode-core/util/error"
import { ServerError } from "@reddb-io/redcode-core/util/server-error"
import { ConfigErrorV1 } from "@reddb-io/redcode-core/v1/config/error"
import { Cause, Effect } from "effect"
import {
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
} from "effect/unstable/http"

// Mirrors the instance server's defect boundary: keep typed HttpApi failures on their declared
// error path, and replace defect-only empty 500s with a logged, ref-tagged response. Without this
// an intermittent defect surfaces to the TUI as an opaque "unexpected server error" with nothing
// behind it in the logs.
export const defectErrorLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  effect.pipe(
    // A client that drops its request (the TUI superseding a read, a closed tab) is routine:
    // effect answers it with 499. Record it at debug so it never reads as a server failure.
    Effect.onInterrupt(() =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        yield* Effect.logDebug("request cancelled by client", { method: request.method, url: request.url })
      }),
    ),
    Effect.catchCause((cause) => {
      const defect = cause.reasons.filter(Cause.isDieReason).find((reason) => {
        if (HttpServerResponse.isHttpServerResponse(reason.defect)) return false
        if (HttpServerError.isHttpServerError(reason.defect)) return false
        if (HttpServerRespondable.isRespondable(reason.defect)) return false
        return true
      })
      if (!defect) return Effect.failCause(cause)

      const error = defect.defect
      if (
        ConfigErrorV1.JsonError.isInstance(error) ||
        ConfigErrorV1.InvalidError.isInstance(error) ||
        ConfigErrorV1.FrontmatterError.isInstance(error) ||
        ConfigErrorV1.DirectoryTypoError.isInstance(error)
      ) {
        return Effect.succeed(HttpServerResponse.jsonUnsafe(error.toObject(), { status: 400 }))
      }

      const ref = `err_${crypto.randomUUID().slice(0, 8)}`

      return Effect.logError("failed", { ref, error, cause: Cause.pretty(cause) }).pipe(
        Effect.as(
          HttpServerResponse.jsonUnsafe(
            new NamedError.Unknown({
              message: ServerError.message(ref, error),
              ref,
            }).toObject(),
            { status: 500 },
          ),
        ),
      )
    }),
  ),
).layer
