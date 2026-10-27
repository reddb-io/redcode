import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InvalidRequestError, UnauthorizedError } from "@opencode/protocol/errors"
import { Api } from "../api"
import { Workers } from "../workers"
import { ServerAccess } from "@opencode/protocol/server-access"
import { ConsoleForbiddenError } from "@opencode/protocol/console"
import { HttpServerResponse } from "effect/unstable/http"
import { workerEnrollmentPage } from "../worker-enrollment-page"

export const WorkersHandler = HttpApiBuilder.group(Api, "server.workers", (handlers) =>
  Effect.gen(function* () {
    const workers = yield* Workers.Service
    const call = <A>(run: () => Promise<A>) =>
      Effect.tryPromise({
        try: run,
        catch: (error) =>
          error instanceof ConsoleForbiddenError || error instanceof UnauthorizedError
            ? error
            : new InvalidRequestError({ message: error instanceof Error ? error.message : "Worker operation failed" }),
      })
    const scoped = <A>(run: (scope: ServerAccess.Principal | undefined) => Promise<A>) =>
      Effect.flatMap(ServerAccess.Current, (scope) => call(() => run(scope)))
    return handlers
      .handle("workers.enrollmentPage", () =>
        Effect.succeed(
          HttpServerResponse.text(workerEnrollmentPage, {
            contentType: "text/html",
            headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
          }),
        ),
      )
      .handle("workers.invite", (ctx) => scoped((scope) => workers.invite(ctx.payload, scope)))
      .handle("workers.revokeInvitation", (ctx) => scoped((scope) => workers.revokeInvitation(ctx.params.code, scope)))
      .handle("workers.enroll", (ctx) => call(() => workers.enroll(ctx.payload)))
      .handle("workers.control", (ctx) => scoped((scope) => workers.control(ctx.params.id, ctx.payload, scope)))
      .handle("workers.resources", (ctx) => scoped((scope) => workers.resources(ctx.params.id, scope)))
      .handle("workers.attention", (ctx) => scoped((scope) => workers.attention(ctx.params.id, scope)))
      .handle("workers.answer", (ctx) => scoped((scope) => workers.answer(ctx.params.id, ctx.payload, scope)))
      .handle("workers.list", () => scoped((scope) => workers.list(scope)))
      .handle("workers.local.add", (ctx) => scoped((scope) => workers.add(ctx.payload, scope)))
      .handle("workers.add", (ctx) => scoped((scope) => workers.add(ctx.payload, scope)))
      .handle("workers.remove", (ctx) => scoped((scope) => workers.remove(ctx.params.id, scope)))
      .handle("workers.probe", (ctx) => scoped((scope) => workers.probe(ctx.params.id, scope)))
      .handle("workers.submit", (ctx) => scoped((scope) => workers.submit(ctx.payload, scope)))
      .handle("workers.recover", (ctx) => scoped((scope) => workers.recover(ctx.params.id, ctx.payload.task, scope)))
      .handle("workers.collect", (ctx) => scoped((scope) => workers.collect(ctx.params.id, ctx.payload.task, scope)))
  }),
)
