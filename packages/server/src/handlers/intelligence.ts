import { IntelligenceArtifacts } from "@opencode/core/intelligence/artifacts"
import { Intelligence } from "@opencode/core/intelligence"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { Api } from "../api"

export const IntelligenceHandler = HttpApiBuilder.group(Api, "server.intelligence", (handlers) =>
  Effect.gen(function* () {
    const artifacts = yield* IntelligenceArtifacts.Service
    const intelligence = yield* Intelligence.Service
    const invalid = (error: { message: string }) => new InvalidRequestError({ message: error.message })
    return handlers
      .handle("intelligence.artifacts", (ctx) => artifacts.list(ctx.query.sessionID).pipe(Effect.mapError(invalid)))
      .handle("intelligence.reviewLearning", (ctx) =>
        artifacts.review(ctx.query.sessionID, ctx.params.id, ctx.payload).pipe(Effect.mapError(invalid)),
      )
      .handle("intelligence.sessionMode", (ctx) =>
        intelligence.sessionMode(ctx.params.sessionID, ctx.payload).pipe(Effect.mapError(invalid)),
      )
      .handle("intelligence.evidence", (ctx) =>
        intelligence.evidence(ctx.query.sessionID, ctx.params.id).pipe(Effect.mapError(invalid)),
      )
      .handle("intelligence.history", (ctx) =>
        intelligence.history(ctx.query.sessionID, { limit: ctx.query.limit }).pipe(Effect.mapError(invalid)),
      )
      .handle("intelligence.status", (ctx) => intelligence.status(ctx.query.sessionID).pipe(Effect.mapError(invalid)))
      .handle("intelligence.save", (ctx) => intelligence.save(ctx.payload).pipe(Effect.mapError(invalid)))
      .handle("intelligence.discover", (ctx) => intelligence.discover(ctx.payload).pipe(Effect.mapError(invalid)))
      .handle("intelligence.probe", (ctx) => intelligence.probe(ctx.payload).pipe(Effect.mapError(invalid)))
  }),
)
