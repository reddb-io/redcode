export * as DesignConversation from "./conversation"

import { Effect, Schema, Stream } from "effect"
import { Sse } from "effect/unstable/encoding"
import { HttpServerResponse } from "effect/unstable/http"
import { eq } from "drizzle-orm"
import { Design } from "@reddb-io/redcode-schema/design"
import { Database } from "@reddb-io/redcode-core/database/database"
import { SessionTable } from "@reddb-io/redcode-core/session/sql"
import { DesignReviewPresence } from "@reddb-io/redcode-core/design/review-presence"
import type { Tool } from "@/tool/tool"
import { InstanceStore } from "@/project/instance-store"
import { WorkspaceRef } from "@/effect/instance-ref"
import type { SessionID } from "@/session/schema"
import { DesignStudio } from "./studio"
import { DesignFeed } from "./feed"
import { DesignFeedback } from "./feedback"
import { DesignHandoff } from "./handoff"
import { DesignReviewServer } from "./review-server"

/**
 * The session side of Design for conversations the TUI runs on the legacy loop: the `design.host`
 * routes and the review page reach the conversation, its bus and the TUI permission queue through here.
 */

/** Runs `effect` in the instance of the session's directory and workspace, as its conversation does. */
export const within = <A, E, R>(sessionID: SessionID, effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const instances = yield* InstanceStore.Service
    const row = yield* database.db
      .select({ directory: SessionTable.directory, workspaceID: SessionTable.workspace_id })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie)
    if (!row) return yield* new Design.Error({ code: "not-found", message: `Session not found: ${sessionID}` })
    return yield* instances.provide(
      { directory: row.directory },
      Effect.gen(function* () {
        const studio = yield* DesignStudio.Service
        yield* studio
          .assertSession(sessionID)
          .pipe(
            Effect.mapError(() => new Design.Error({ code: "not-found", message: `Session not found: ${sessionID}` })),
          )
        return yield* effect
      }).pipe(Effect.provideService(WorkspaceRef, row.workspaceID ?? undefined)),
    )
  })

/** The review page of the session on this process's server. */
export const review = Effect.fn("DesignConversation.review")(function* (sessionID: SessionID) {
  const server = yield* DesignReviewServer.Service
  return new URL(`/design/session/${sessionID}/review`, yield* server.url).toString()
})

/**
 * Asks through the TUI permission queue with the session agent's rules, never a second queue. A
 * refusal fails with the permission error.
 */
export const ask = Effect.fn("DesignConversation.ask")(function* (sessionID: SessionID) {
  const { Permission } = yield* Effect.promise(() => import("@/permission"))
  const { Agent } = yield* Effect.promise(() => import("@/agent/agent"))
  const permissions = yield* Permission.Service
  const agents = yield* Agent.Service
  const studio = yield* DesignStudio.Service
  const session = yield* studio.assertSession(sessionID)
  const agent = yield* agents.get(session.agent ?? "design")
  const ruleset = Permission.merge(agent?.permission ?? [], session.permission ?? [])
  return (input: Parameters<Tool.Context["ask"]>[0]) => permissions.ask({ ...input, sessionID, ruleset })
})

/** The conversation as Server-Sent Events. A subscriber counts as a connected review page. */
export const feed = Effect.fn("DesignConversation.feed")(function* (sessionID: SessionID) {
  const feed = yield* DesignFeed.Service
  // The legacy bus has no durable sequence: every connection replays the whole transcript and the
  // page merges repeats by id.
  const encoded = (yield* feed.stream(sessionID)).pipe(
    Stream.map(
      (event): Sse.Event => ({
        _tag: "Event",
        event: "message",
        id: undefined,
        data: JSON.stringify(Schema.encodeSync(Design.FeedEvent)(event)),
      }),
    ),
    Stream.pipeThroughChannel(Sse.encode()),
    (stream) => Stream.unwrap(Effect.as(DesignReviewPresence.hold(sessionID), stream)),
  )
  const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => ": heartbeat\n\n"))
  return HttpServerResponse.stream(encoded.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText), {
    contentType: "text/event-stream",
    headers: {
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    },
  })
})

/** Approves a revision, writes the plan's Design section and continues the conversation in Plan mode. */
export const approve = Effect.fn("DesignConversation.approve")(function* (
  sessionID: SessionID,
  designID: Design.ID,
  input: Design.Approve,
) {
  const approved = yield* DesignHandoff.approve(sessionID, designID, input.revision, input.variant)
  if (!approved.resume) return approved
  const feedback = yield* DesignFeedback.Service
  yield* feedback.resume(sessionID)
  return approved
})
