import { Event } from "@opencode/schema/event"
import { ClientPresence } from "@opencode/schema/client-presence"
import { Effect, Schema, Stream } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { EventFeed } from "../event-feed"

const heartbeatFrame = new TextEncoder().encode(": heartbeat\n\n")

export const EventHandler = HttpApiBuilder.group(Api, "server.event", (handlers) =>
  Effect.gen(function* () {
    const feed = yield* EventFeed.Service
    return handlers
      .handleRaw("event.subscribe", (ctx) =>
        Effect.gen(function* () {
          const surface = ctx.request.headers[ClientPresence.SURFACE_HEADER]
          const client = {
            id: ctx.request.headers[ClientPresence.CLIENT_ID_HEADER],
            surface: Schema.is(ClientPresence.Surface)(surface) ? surface : "unknown",
            version: ctx.request.headers[ClientPresence.VERSION_HEADER],
          } as const
          const resume =
            ctx.query.epoch !== undefined && ctx.query.cursor !== undefined
              ? { epoch: ctx.query.epoch, cursor: ctx.query.cursor }
              : undefined
          const output = Stream.unwrap(
            feed.connectClient(client, resume).pipe(
              Effect.map((connection) => {
                const connected = {
                  id: Event.ID.create(),
                  created: Date.now(),
                  type: "server.connected",
                  data: {
                    stream: {
                      epoch: connection.epoch,
                      cursor: connection.cursor,
                      replayed: connection.replayed,
                      reset: connection.reset,
                    },
                  },
                } as const
                return Stream.make(EventFeed.frameBytes(connected)).pipe(Stream.concat(connection.stream))
              }),
            ),
          )
          const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => heartbeatFrame))
          return HttpServerResponse.stream(output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" })), {
            contentType: "text/event-stream",
            headers: {
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
              "X-Content-Type-Options": "nosniff",
            },
          })
        }),
      )
      .handle("event.ack", (ctx) =>
        feed.acknowledge(ctx.request.headers[ClientPresence.CLIENT_ID_HEADER], ctx.payload),
      )
  }),
)
