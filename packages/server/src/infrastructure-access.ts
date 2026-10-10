export * as InfrastructureAccess from "./infrastructure-access.js"

import { Infrastructure } from "@opencode/schema/infrastructure"
import { ConsoleForbiddenError } from "@opencode/protocol/console"
import { UnauthorizedError } from "@opencode/protocol/errors"
import { Context, Effect, Layer, Schema } from "effect"

export const Options = Schema.Struct({ consoleURL: Schema.String, resourceID: Infrastructure.ID })
export interface Options extends Schema.Schema.Type<typeof Options> {}
export const validate = (options: Options) => {
  const url = new URL(options.consoleURL)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error("Console access requires an HTTPS origin or loopback HTTP")
  return options
}
export class Service extends Context.Service<
  Service,
  {
    readonly configured: boolean
    readonly resourceID?: string
    readonly verify: (
      token: string,
      resourceID?: string,
      workspaceID?: string,
    ) => Effect.Effect<Infrastructure.Access, UnauthorizedError | ConsoleForbiddenError>
  }
>()("@redcode/InfrastructureAccess") {}
export const layer = (input?: Options) =>
  Layer.sync(Service, () => {
    const options = input ? validate(input) : undefined
    return {
      configured: !!options,
      resourceID: options?.resourceID,
      verify: (token, resourceID = options?.resourceID, workspaceID) =>
        Effect.gen(function* () {
          if (!options || !resourceID)
            return yield* new UnauthorizedError({ message: "Console access is not configured on this server" })
          const url = new URL(`/api/console/resources/${encodeURIComponent(resourceID)}/access`, options.consoleURL)
          if (workspaceID) url.searchParams.set("workspaceID", workspaceID)
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(url, {
                headers: { authorization: `Bearer ${token}` },
                redirect: "error",
                signal: AbortSignal.timeout(5_000),
              }),
            catch: () => new ConsoleForbiddenError({ message: "Unable to verify infrastructure access" }),
          })
          if (response.status === 401) return yield* new UnauthorizedError({ message: "Sign in to the Console again" })
          if (!response.ok) return yield* new ConsoleForbiddenError({ message: "Infrastructure access denied" })
          const value = yield* Effect.tryPromise({
            try: () => response.json(),
            catch: () => new ConsoleForbiddenError({ message: "Invalid Console access response" }),
          })
          const access = yield* Schema.decodeUnknownEffect(Infrastructure.Access)(value).pipe(
            Effect.mapError(() => new ConsoleForbiddenError({ message: "Invalid Console access response" })),
          )
          if (access.resourceID !== resourceID || access.workspaceID !== workspaceID)
            return yield* new ConsoleForbiddenError({ message: "Console access scope does not match this request" })
          return access
        }),
    }
  })
