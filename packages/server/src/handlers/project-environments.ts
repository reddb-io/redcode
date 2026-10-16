import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { ServerAccess } from "@opencode/protocol/server-access"
import { ConsoleForbiddenError } from "@opencode/protocol/console"
import { Api } from "../api"
import { ProjectEnvironments } from "../project-environments"

export const ProjectEnvironmentsHandler = HttpApiBuilder.group(Api, "server.projectEnvironments", (handlers) =>
  Effect.gen(function* () {
    const environments = yield* ProjectEnvironments.Service
    const call = <A>(run: () => Promise<A>) =>
      Effect.gen(function* () {
        const principal = yield* ServerAccess.Current
        if (principal && principal.access.ownerRole !== "admin")
          return yield* new ConsoleForbiddenError({
            message: "Infrastructure administration is required for project environments",
          })
        return yield* Effect.tryPromise({
          try: run,
          catch: (error) =>
            new InvalidRequestError({
              message: error instanceof Error ? error.message : "Environment operation failed",
            }),
        })
      })
    return handlers
      .handle("projectEnvironments.list", (ctx) => call(() => environments.list(ctx.query.directory)))
      .handle("projectEnvironments.save", (ctx) => call(() => environments.save(ctx.payload)))
      .handle("projectEnvironments.run", (ctx) => call(() => environments.run(ctx.payload)))
  }),
)
