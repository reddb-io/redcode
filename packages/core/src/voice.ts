export * as Voice from "./voice.js"

import { Media, Transcription, TranscriptionClient } from "@opencode/ai"
import { OpenAI, ElevenLabs, Deepgram } from "@opencode/ai/providers"
import { Auth, RequestExecutor } from "@opencode/ai/route"
import { Voice } from "@opencode/schema/voice"
import { Integration } from "@opencode/schema/integration"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Config } from "./config.js"
import { Credential } from "./credential.js"
import { requestExecutor } from "./effect/app-node-platform.js"

export class Invalid extends Schema.TaggedError<Invalid>()("Voice.Invalid", { message: Schema.String }) {}
export class Unavailable extends Schema.TaggedError<Unavailable>()("Voice.Unavailable", { message: Schema.String }) {}

export interface Interface {
  readonly connections: () => Effect.Effect<Voice.SavedConnection[]>
  readonly connect: (input: Voice.ConnectInput) => Effect.Effect<Voice.SavedConnection>
  readonly transcribe: (audio: string) => Effect.Effect<string, Invalid | Unavailable>
}
export class Service extends Context.Service<Service, Interface>()("@redcode/Voice") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const credentials = yield* Credential.Service
    const executor = yield* RequestExecutor.Service

    return Service.of({
      connections: Effect.fn("Voice.connections")(function* () {
        return (yield* credentials.all()).flatMap((entry) =>
          entry.value.type === "key" ? [{ id: entry.id, label: entry.label, integrationID: entry.integrationID }] : [],
        )
      }),
      connect: Effect.fn("Voice.connect")(function* (input) {
        // Voice credentials have their own integration so coding-account selection is untouched.
        const entry = yield* credentials.create({
          integrationID: Integration.ID.make("redcode-voice"),
          label: input.label,
          value: Credential.Key.make({ type: "key", key: input.key }),
          activate: false,
        })
        return { id: entry.id, label: entry.label, integrationID: entry.integrationID }
      }),
      transcribe: Effect.fn("Voice.transcribe")(function* (audio) {
        const settings = Config.latest(yield* config.entries(), "voice")
        if (!settings) return yield* new Invalid({ message: "Choose a dictation provider in Voice settings first" })
        if (settings.provider === "openai-compatible" && !settings.baseURL)
          return yield* new Invalid({ message: "An OpenAI-compatible dictation endpoint is required" })
        if (settings.baseURL && !validEndpoint(settings.baseURL))
          return yield* new Invalid({ message: "Dictation requires an HTTPS endpoint, or HTTP on localhost" })
        if (!settings.connection && settings.provider !== "openai-compatible")
          return yield* new Invalid({ message: "Choose an explicit dictation connection" })

        const credential =
          settings.connection?.type === "credential" ? yield* credentials.get(settings.connection.id) : undefined
        const key =
          settings.connection?.type === "env"
            ? process.env[settings.connection.name]
            : credential?.value.type === "key"
              ? credential.value.key
              : undefined
        if (settings.connection && !key)
          return yield* new Invalid({
            message: "The selected dictation connection is unavailable or is not an API key",
          })

        if (audio.length > 12_800_060 || /[^A-Za-z0-9+/=]/.test(audio))
          return yield* new Invalid({ message: "Invalid dictation audio encoding" })
        const bytes = Buffer.from(audio, "base64")
        if (
          bytes.toString("base64") !== audio ||
          bytes.length < 46 ||
          bytes.length > Voice.MaxAudioBytes ||
          bytes.toString("ascii", 0, 4) !== "RIFF" ||
          bytes.toString("ascii", 8, 12) !== "WAVE" ||
          bytes.toString("ascii", 12, 16) !== "fmt " ||
          bytes.readUInt32LE(16) !== 16 ||
          bytes.readUInt16LE(20) !== 1 ||
          bytes.readUInt16LE(22) !== 1 ||
          bytes.readUInt32LE(24) !== 16_000 ||
          bytes.readUInt16LE(34) !== 16 ||
          bytes.toString("ascii", 36, 40) !== "data" ||
          bytes.readUInt32LE(40) !== bytes.length - 44
        )
          return yield* new Invalid({ message: "Dictation requires a WAV recording of up to five minutes" })

        // Override provider auth explicitly: their default auth chains can fall back to ambient environment keys.
        const auth = !key
          ? Auth.none
          : settings.provider === "elevenlabs"
            ? Auth.value(key).header("xi-api-key")
            : settings.provider === "deepgram"
              ? Auth.value(key).pipe(Auth.scheme("Token"))
              : Auth.value(key).bearer()
        const options = { auth, ...(settings.baseURL ? { baseURL: settings.baseURL } : {}) }
        const provider =
          settings.provider === "elevenlabs"
            ? ElevenLabs.configure(options)
            : settings.provider === "deepgram"
              ? Deepgram.configure(options)
              : OpenAI.configure(options)
        const response = yield* Transcription.generate({
          model: provider.transcription(settings.model),
          audio: Media.bytes(bytes, "audio/wav"),
          ...(settings.language ? { language: settings.language } : {}),
        }).pipe(
          Effect.provide(TranscriptionClient.layer),
          Effect.provideService(RequestExecutor.Service, executor),
          Effect.timeout("90 seconds"),
          Effect.tapError((error) =>
            Effect.logWarning("dictation request failed", { provider: settings.provider, reason: error._tag }),
          ),
          Effect.mapError(
            () =>
              new Unavailable({
                message: "Dictation failed. Check the selected provider, model, connection, and quota",
              }),
          ),
        )
        return response.text.trim()
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Config.node, Credential.node, requestExecutor] })

function validEndpoint(value: string) {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return (
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
}
