import { Voice } from "@opencode/core/voice"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpServerResponse } from "effect/unstable/http"
import { Api } from "../api"

export const VoiceHandler = HttpApiBuilder.group(Api, "server.voice", (handlers) =>
  handlers
    .handle(
      "voice.connections",
      Effect.fn(function* () {
        const voice = yield* Voice.Service
        return { data: yield* voice.connections() }
      }),
    )
    .handle(
      "voice.connect",
      Effect.fn(function* (request) {
        const voice = yield* Voice.Service
        return { data: yield* voice.connect(request.payload) }
      }),
    )
    .handle(
      "voice.models",
      Effect.fn(function* (request) {
        const voice = yield* Voice.Service
        const models = yield* voice.models(request.payload).pipe(Effect.catchTags({
          "Voice.Invalid": (error) => new InvalidRequestError({ message: error.message }),
          "Voice.Unavailable": (error) => new ServiceUnavailableError({ message: error.message }),
        }))
        return { data: models }
      }),
    )
    .handle(
      "voice.realtime",
      Effect.fn(function* () {
        const voice = yield* Voice.Service
        const access = yield* voice.realtime().pipe(Effect.catchTags({
          "Voice.Invalid": (error) => new InvalidRequestError({ message: error.message }),
          "Voice.Unavailable": (error) => new ServiceUnavailableError({ message: error.message }),
        }))
        return HttpServerResponse.jsonUnsafe({ data: access }, { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } })
      }),
    )
    .handle(
      "voice.transcribe",
      Effect.fn(function* (request) {
        const voice = yield* Voice.Service
        const text = yield* voice.transcribe(request.payload.audio).pipe(
          Effect.catchTags({
            "Voice.Invalid": (error) => new InvalidRequestError({ message: error.message }),
            "Voice.Unavailable": (error) => new ServiceUnavailableError({ message: error.message }),
          }),
        )
        return { data: { text } }
      }),
    ),
)
