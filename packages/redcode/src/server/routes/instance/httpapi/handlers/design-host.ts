import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import type { HttpServerRequest } from "effect/unstable/http"
import { Api } from "@reddb-io/redcode-server/api"
import { ForbiddenError } from "@reddb-io/redcode-protocol/errors"
import { Design } from "@reddb-io/redcode-schema/design"
import { DesignConversations } from "@reddb-io/redcode-core/design/conversations"
import { DesignReviewPresence } from "@reddb-io/redcode-core/design/review-presence"
import { DesignConversation } from "@/design/conversation"
import { DesignFeedback } from "@/design/feedback"
import { DesignHost } from "@reddb-io/redcode-core/design/host"
import type { SessionID } from "@/session/schema"

/** `design.host` for conversations on the legacy loop: the TUI's transcript, bus and permission queue. */
export const designHostHandlers = HttpApiBuilder.group(Api, "design.host", (handlers) =>
  Effect.gen(function* () {
    const feedback = yield* DesignFeedback.Service
    return (
      handlers
        .handle("designHost.list", (ctx) =>
          guard(ctx.request).pipe(Effect.andThen(DesignConversations.list(ctx.query.directory))),
        )
        .handle("designHost.open", (ctx) =>
          serve(
            ctx.request,
            ctx.params.sessionID,
            Effect.gen(function* () {
              return {
                url: yield* DesignConversation.review(ctx.params.sessionID),
                // Review pages following this session's feed in this server, so a client opens no second tab.
                connected: DesignReviewPresence.shared.connected(ctx.params.sessionID),
              }
            }),
          ),
        )
        // Clients (the TUI command, `redcode design`) claim a browser launch here, against the same presence
        // the review feeds and the Design tool use, and give the claim back when their launch fails.
        .handle("designHost.launch", (ctx) =>
          serve(
            ctx.request,
            ctx.params.sessionID,
            Effect.gen(function* () {
              return {
                url: yield* DesignConversation.review(ctx.params.sessionID),
                ...DesignReviewPresence.shared.claim(ctx.params.sessionID, { explicit: ctx.payload.explicit === true }),
              }
            }),
          ),
        )
        .handle("designHost.release", (ctx) =>
          serve(
            ctx.request,
            ctx.params.sessionID,
            Effect.sync(() => DesignReviewPresence.shared.release(ctx.params.sessionID, ctx.payload.token)),
          ),
        )
        // `after` is accepted for parity with SessionV2 but not applied: see DesignConversation.feed.
        .handleRaw("designHost.feed", (ctx) =>
          serve(ctx.request, ctx.params.sessionID, DesignConversation.feed(ctx.params.sessionID)),
        )
        .handle("designHost.feedback", (ctx) =>
          serve(
            ctx.request,
            ctx.params.sessionID,
            feedback.admit(ctx.params.sessionID, ctx.params.designID, ctx.payload),
          ),
        )
        .handle("designHost.approve", (ctx) =>
          serve(
            ctx.request,
            ctx.params.sessionID,
            DesignConversation.approve(ctx.params.sessionID, ctx.params.designID, ctx.payload),
          ),
        )
        .handle("designHost.permission", (ctx) =>
          serve(
            ctx.request,
            ctx.params.sessionID,
            Effect.gen(function* () {
              const ask = yield* DesignConversation.ask(ctx.params.sessionID)
              return yield* ask({
                permission: ctx.payload.permission,
                patterns: ctx.payload.patterns,
                always: ctx.payload.always ?? [],
                metadata: { ...ctx.payload.metadata, origin: "design.host" },
              }).pipe(
                Effect.as({ granted: true }),
                // Every permission failure is a refusal: a deny rule, a rejected prompt or a correction.
                Effect.orElseSucceed(() => ({ granted: false })),
              )
            }),
          ),
        )
    )
  }),
)

/** Runs a session-side action in the session's instance; failures other than Design's own surface as unavailable. */
function serve<A, E, R>(
  request: HttpServerRequest.HttpServerRequest,
  sessionID: SessionID,
  effect: Effect.Effect<A, E, R>,
) {
  return guard(request).pipe(
    Effect.andThen(DesignConversation.within(sessionID, effect)),
    Effect.mapError((error) =>
      error instanceof ForbiddenError || error instanceof Design.Error
        ? error
        : new Design.Error({ code: "unavailable", message: error instanceof Error ? error.message : String(error) }),
    ),
  )
}

/**
 * The review surface serves model-written HTML and admits feedback, so it answers only names that are
 * this machine, and a write only from its own origin with a JSON body: no other site can drive it.
 */
function guard(request: HttpServerRequest.HttpServerRequest): Effect.Effect<void, ForbiddenError> {
  if (!DesignHost.allowed(request.headers.host))
    return Effect.fail(new ForbiddenError({ message: "Design is not served under this host name" }))
  if (request.method === "GET") return Effect.void
  const origin = request.headers.origin
  if (origin && (!URL.canParse(origin) || new URL(origin).host !== request.headers.host))
    return Effect.fail(new ForbiddenError({ message: "Design refuses cross-origin writes" }))
  if (!request.headers["content-type"]?.startsWith("application/json"))
    return Effect.fail(new ForbiddenError({ message: "Design writes must be JSON" }))
  return Effect.void
}
