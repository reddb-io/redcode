import { AgentTools } from "@opencode/core/agent-tools"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { ConsoleForbiddenError } from "@opencode/protocol/console"
import { ServerAccess } from "@opencode/protocol/server-access"
import { Api } from "../api"

export const AgentToolsHandler = HttpApiBuilder.group(Api, "server.agentTools", (handlers) =>
  Effect.gen(function* () {
    const tools = yield* AgentTools.Service
    const call = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const principal = yield* ServerAccess.Current
        if (principal && principal.access.ownerRole !== "admin")
          return yield* Effect.fail(
            new ConsoleForbiddenError({ message: "Infrastructure administration is required for agent tools" }),
          )
        return yield* effect.pipe(
          Effect.mapError(
            (error) =>
              new InvalidRequestError({
                message: error instanceof Error ? error.message : "Agent tool operation failed",
              }),
          ),
        )
      })
    return handlers
      .handle("agentTools.list", () => call(tools.list()))
      .handle("agentTools.configure", (ctx) => call(tools.configure(ctx.payload)))
      .handle("agentTools.install", (ctx) => call(tools.install(ctx.params.id)))
      .handle("agentTools.probe", (ctx) => call(tools.probe(ctx.params.id)))
      .handle("agentTools.initialize", (ctx) => call(tools.rift({ command: "init", at: ctx.payload.directory })))
  }),
)
