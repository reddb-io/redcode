import { Generate } from "@opencode/core/generate"
import { RemoteCheck } from "@opencode/core/remote-check"
import { ConnectionCheck } from "@opencode/schema/connection-check"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const GenerateHandler = HttpApiBuilder.group(Api, "server.generate", (handlers) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    return handlers.handle(
      "generate.text",
      Effect.fn("server.generate.text")(function* (request) {
        const directory = request.query.location?.directory ?? global.config
        return yield* Effect.gen(function* () {
          const generate = yield* Generate.Service
          const requests: ConnectionCheck.Request[] = []
          const call = generate.text({
            ...request.payload,
            ...(request.payload.check ? { http: RemoteCheck.http(requests) } : {}),
          })
          const checked = request.payload.check
            ? call.pipe(
                Effect.timeout("15 seconds"),
                Effect.catchTag("TimeoutError", () => {
                  const last = requests.at(-1)
                  if (last) last.failure = "timeout"
                  return Effect.fail(
                    new Generate.UnavailableError({ message: "Remote API check timed out after 15 seconds" }),
                  )
                }),
              )
            : call
          const text = yield* checked.pipe(
            Effect.mapError((error) =>
              error._tag === "Generate.ModelSelectionError"
                ? new InvalidRequestError({ message: error.message })
                : new ServiceUnavailableError({
                    message: error.message,
                    service: error.service,
                    requests: request.payload.check ? requests : undefined,
                  }),
            ),
          )
          return { data: { text, requests: request.payload.check ? requests : undefined } }
        }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))))
      }),
    )
  }),
)
