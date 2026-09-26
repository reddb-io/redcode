import { Intelligence } from "@opencode/core/intelligence"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { Api } from "../api"

export const IntelligenceHandler = HttpApiBuilder.group(Api, "server.intelligence", (handlers) =>
  Effect.gen(function* () {
    const intelligence = yield* Intelligence.Service
    const invalid = (error: { message: string }) => new InvalidRequestError({ message: error.message })
    return handlers
      .handle("intelligence.status", () => intelligence.status().pipe(Effect.mapError(invalid)))
      .handle("intelligence.save", (ctx) => intelligence.save(ctx.payload).pipe(Effect.mapError(invalid)))
      .handle("intelligence.discover", (ctx) => intelligence.discover(ctx.payload).pipe(Effect.mapError(invalid)))
      .handle("intelligence.probe", (ctx) => intelligence.probe(ctx.payload).pipe(Effect.mapError(invalid)))
  }),
)
