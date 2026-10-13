import { Reporter } from "@opencode/core/usage/reporter"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { ServerAccess } from "@opencode/protocol/server-access"
import { ConsoleForbiddenError } from "@opencode/protocol/console"
import { Api } from "../api"

export const UsageReporterHandler = HttpApiBuilder.group(Api, "server.usageReporter", (handlers) =>
  Effect.gen(function* () {
    const reporter = yield* Reporter.Service
    const call = <A, E extends Error>(effect: Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const principal = yield* ServerAccess.Current
        if (principal && principal.access.ownerRole !== "admin")
          return yield* new ConsoleForbiddenError({
            message: "Infrastructure administration is required for usage reporting",
          })
        return yield* effect.pipe(Effect.mapError((error) => new InvalidRequestError({ message: error.message })))
      })
    return handlers
      .handle("usageReporter.snapshot", () => call(reporter.snapshot()))
      .handle("usageReporter.configure", (ctx) => call(reporter.configure(ctx.payload)))
      .handle("usageReporter.flush", () =>
        call(reporter.collect().pipe(Effect.andThen(reporter.dispatch()), Effect.andThen(reporter.snapshot()))),
      )
      .handle("usageReporter.retry", (ctx) =>
        call(reporter.retry(ctx.params.id, ctx.query.destination).pipe(Effect.andThen(reporter.snapshot()))),
      )
  }),
)
