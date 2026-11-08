import { Event } from "@opencode/schema/event"
import { ClientPresence } from "@opencode/schema/client-presence"
import { Effect, Schema, Stream } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { EventFeed } from "../event-feed"

export const EventHandler = HttpApiBuilder.group(Api, "server.event", (handlers) =>
  Effect.gen(function* () {
    const feed = yield* EventFeed.Service
    return handlers.handleRaw("event.subscribe", (ctx) =>
      Effect.gen(function* () {
        const connected = {
          id: Event.ID.create(),
          type: "server.connected",
          data: {},
        } as const
        const surface = ctx.request.headers[ClientPresence.SURFACE_HEADER]
        const client = {
          id: ctx.request.headers[ClientPresence.CLIENT_ID_HEADER],
          surface: Schema.is(ClientPresence.Surface)(surface) ? surface : "unknown",
          version: ctx.request.headers[ClientPresence.VERSION_HEADER],
        } as const
        const output = Stream.unwrap(
          feed
            .subscribeClient(client)
            .pipe(Effect.map((live) => Stream.make(EventFeed.frame(connected)).pipe(Stream.concat(live)))),
        )
        const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => ": heartbeat\n\n"))
        return HttpServerResponse.stream(
          output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText),
          {
            contentType: "text/event-stream",
            headers: {
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
              "X-Content-Type-Options": "nosniff",
            },
          },
        )
      }),
    )
  }),
)
