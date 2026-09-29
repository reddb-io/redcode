import { Cause, Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerRespondable, HttpServerResponse } from "effect/unstable/http"
import { Logging } from "@opencode/util/observability/logging"

/**
 * Every defect that escapes a route becomes a 500 that can be diagnosed from what the client
 * already shows: the cause's first line, an `err_xxxxxxxx` reference logged next to the full
 * cause, and the log file that holds it. The stack never leaves the server. Typed failures,
 * encoded error responses and interrupts keep their own handling.
 */
export const defectLayer = (channel = "local") => {
  // The same file the server process logs to (see Observability.layer).
  const log = Logging.file(channel === "local", channel)
  return HttpRouter.middleware(
    (effect) =>
      Effect.catchCause(effect, (cause) => {
        const defect = unhandledDefect(cause)
        if (defect === undefined) return Effect.failCause(cause)
        const ref = `err_${crypto.randomUUID().slice(0, 8)}`
        return Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          yield* Effect.logError("unhandled server defect", { cause }).pipe(
            Effect.annotateLogs({ ref, method: request.method, url: request.url }),
          )
          return HttpServerResponse.jsonUnsafe(
            {
              _tag: "UnknownError",
              message: `Unexpected server error: ${firstLine(defect)} (ref ${ref}; details in ${log})`,
              ref,
              log,
            },
            { status: 500 },
          )
        })
      }),
    { global: true },
  )
}

/** A defect nothing else will answer: not an encoded response, not a respondable error, not beside a typed failure. */
function unhandledDefect(cause: Cause.Cause<unknown>) {
  if (Cause.hasFails(cause)) return undefined
  return cause.reasons
    .filter(Cause.isDieReason)
    .map((reason) => reason.defect)
    .find((defect) => !HttpServerResponse.isHttpServerResponse(defect) && !HttpServerRespondable.isRespondable(defect))
}

function firstLine(defect: unknown) {
  const text = defect instanceof Error ? defect.message || defect.name : String(defect)
  return text.split("\n")[0]?.trim() || "unknown defect"
}
