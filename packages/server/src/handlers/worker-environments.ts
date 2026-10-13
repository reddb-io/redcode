import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { ServerAccess } from "@opencode/protocol/server-access"
import { ConsoleForbiddenError } from "@opencode/protocol/console"
import { Api } from "../api"
import { WorkerEnvironments } from "../worker-environments"
import { Workers } from "../workers"

export const WorkerEnvironmentsHandler = HttpApiBuilder.group(Api, "server.workerEnvironments", (handlers) =>
  Effect.gen(function* () {
    const environments = yield* WorkerEnvironments.Service
    const workers = yield* Workers.Service
    const call = <A>(run: () => Promise<A>, idleID?: string) => Effect.gen(function* () {
      const principal = yield* ServerAccess.Current
      if (principal && principal.access.ownerRole !== "admin")
        return yield* new ConsoleForbiddenError({ message: "Infrastructure administration is required for worker environments" })
      return yield* Effect.tryPromise({
        try: async () => {
          if (idleID && (await workers.list()).workers.some((worker) => worker.worker.environmentID === idleID))
            throw new Error("Remove this environment from its worker registry before stopping or archiving it")
          return run()
        },
        catch: (error) => new InvalidRequestError({ message: error instanceof Error ? error.message : "Environment operation failed" }),
      })
    })
    return handlers
      .handle("workerEnvironments.list", () => call(() => environments.list()))
      .handle("workerEnvironments.build", (ctx) => call(() => environments.build(ctx.payload.version)))
      .handle("workerEnvironments.create", (ctx) => call(() => environments.create(ctx.payload)))
      .handle("workerEnvironments.start", (ctx) => call(() => environments.start(ctx.params.id)))
      .handle("workerEnvironments.register", (ctx) => Effect.gen(function* () {
        const principal = yield* ServerAccess.Current
        return yield* call(async () => {
          const connection = await environments.connection(ctx.params.id)
          return workers.add({ id: ctx.params.id, url: connection.url, password: connection.password,
            directories: ["/workspace/project"], tags: ["isolated"], environmentID: ctx.params.id,
            ...(ctx.payload.resourceID ? { resourceID: ctx.payload.resourceID } : {}),
          }, ctx.payload.resourceID ? principal : undefined)
        })
      }))
      .handle("workerEnvironments.stop", (ctx) => call(() => environments.stop(ctx.params.id), ctx.params.id))
      .handle("workerEnvironments.remove", (ctx) => call(() => environments.remove(ctx.params.id, ctx.query.purge), ctx.params.id))
      .handle("workerEnvironments.request", (ctx) => call(() => environments.request(ctx.params.id, ctx.payload)))
  }),
)
