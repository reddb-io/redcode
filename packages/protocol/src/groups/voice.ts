import { Voice } from "@opencode/schema/voice"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const VoiceGroup = HttpApiGroup.make("server.voice").add(
  HttpApiEndpoint.get("voice.connections", "/api/voice/connections", {
    query: LocationQuery,
    success: Schema.Struct({ data: Schema.Array(Voice.SavedConnection) }),
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(OpenApi.annotations({ identifier: "voice.connections", summary: "List saved voice API key names" })),
  HttpApiEndpoint.post("voice.connect", "/api/voice/connections", {
    query: LocationQuery,
    payload: Voice.ConnectInput,
    success: Schema.Struct({ data: Voice.SavedConnection }),
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(OpenApi.annotations({ identifier: "voice.connect", summary: "Store a dedicated voice API key" })),
  HttpApiEndpoint.post("voice.transcribe", "/api/voice/transcribe", {
    query: LocationQuery,
    payload: Schema.Struct({ audio: Voice.Audio }),
    success: Schema.Struct({ data: Schema.Struct({ text: Schema.String }) }),
    error: [InvalidRequestError, ServiceUnavailableError],
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(
      OpenApi.annotations({
        identifier: "voice.transcribe",
        summary: "Transcribe a recording into an editable draft",
      }),
    ),
)
