import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"

export default Runtime.handler(
  Commands.commands.models,
  Effect.fn("cli.models")(function* (input) {
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const client = OpenCode.make({
      baseUrl: server.endpoint.url,
      headers: Service.headers(server.endpoint),
    })
    if (input.refresh || input.catalogStatus) {
      const result = input.refresh
        ? yield* Effect.tryPromise({
            try: (signal) => client.server.refreshModelCatalog({ signal }),
            catch: (cause) => cause,
          })
        : undefined
      const catalog =
        result?.catalog ??
        (yield* Effect.tryPromise({
          try: (signal) => client.server.modelCatalog({ signal }),
          catch: (cause) => cause,
        }))
      process.stdout.write(
        [
          `Source: ${catalog.origin ?? catalog.source}`,
          `Last successful update: ${catalog.updatedAt === undefined ? "unavailable" : new Date(catalog.updatedAt).toISOString()}`,
          ...(result ? [`Refresh: ${result.outcome}`] : []),
        ].join(EOL) + EOL,
      )
      if (result?.outcome === "unavailable") return yield* Effect.fail(new Error("No catalog source returned a valid catalog. The existing catalog was kept."))
      if (result?.outcome === "disabled") return yield* Effect.fail(new Error("Catalog refresh is disabled on this server."))
      return
    }
    const response = yield* Effect.promise(() => client.model.list({ location: { directory: process.cwd() } }))
    const models = response.data
      .map((model) => `${model.providerID}/${model.id}`)
      .toSorted((a, b) => a.localeCompare(b))
    if (models.length > 0) process.stdout.write(models.join(EOL) + EOL)
  }),
)
