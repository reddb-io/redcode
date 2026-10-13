import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { ServerAccess } from "@opencode/protocol/server-access"
import { ConsoleForbiddenError } from "@opencode/protocol/console"
import { Api } from "../api"
import { Harnesses } from "../harness"

export const HarnessHandler = HttpApiBuilder.group(Api, "server.harness", (handlers) =>
  Effect.gen(function* () {
    const harness = yield* Harnesses.Service
    const call = <A>(run: () => A | Promise<A>) =>
      Effect.gen(function* () {
        const principal = yield* ServerAccess.Current
        if (principal && principal.access.ownerRole !== "admin")
          return yield* Effect.fail(
            new ConsoleForbiddenError({ message: "Infrastructure administration is required for host harnesses" }),
          )
        return yield* Effect.tryPromise({
          try: async () => run(),
          catch: (error) =>
            new InvalidRequestError({ message: error instanceof Error ? error.message : "Harness operation failed" }),
        })
      })
    return handlers
      .handle("harness.list", () => call(() => harness.list()))
      .handle("harness.reconcile", (ctx) => call(() => harness.reconcile(ctx.params.runID)))
      .handle("harness.install", (ctx) => call(() => harness.install(ctx.params.driver)))
      .handle("harness.loginAnswer", (ctx) => call(() => harness.loginAnswer(ctx.params.driver, ctx.payload.code)))
      .handle("harness.cancelLogin", (ctx) => call(() => harness.cancelLogin(ctx.params.driver)))
      .handle("harness.configure", (ctx) => call(() => harness.configure(ctx.payload)))
      .handle("harness.probe", (ctx) => call(() => harness.probe(ctx.params.driver)))
      .handle("harness.login", (ctx) => call(() => harness.login(ctx.params.driver)))
      .handle("harness.loginStatus", (ctx) => call(() => harness.loginStatus(ctx.params.driver)))
      .handle("harness.open", (ctx) => call(() => harness.open(ctx.payload)))
      .handle("harness.read", (ctx) => call(() => harness.read(ctx.params.runID)))
      .handle("harness.prompt", (ctx) => call(() => harness.prompt(ctx.params.runID, ctx.payload)))
      .handle("harness.interrupt", (ctx) => call(() => harness.interrupt(ctx.params.runID)))
      .handle("harness.answer", (ctx) => call(() => harness.answer(ctx.params.runID, ctx.payload)))
      .handle("harness.resume", (ctx) => call(() => harness.resume(ctx.params.runID)))
      .handle("harness.close", (ctx) => call(() => harness.close(ctx.params.runID)))
  }),
)
