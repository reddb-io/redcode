export * as Voice from "./voice.js"

import { AIError, Media, Transcription, TranscriptionClient } from "@opencode/ai"
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
  readonly models: (input: typeof Voice.ModelsInput.Type) => Effect.Effect<(typeof Voice.Model.Type)[], Invalid | Unavailable>
  readonly transcribe: (audio: string) => Effect.Effect<string, Invalid | Unavailable>
  readonly realtime: () => Effect.Effect<Voice.RealtimeAccess, Invalid | Unavailable>
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
      models: Effect.fn("Voice.models")(function* (input) {
        if (input.baseURL && !validEndpoint(input.baseURL)) return yield* new Invalid({ message: "Model discovery requires an HTTPS endpoint, or HTTP on localhost" })
        if (input.provider === "deepgram") return yield* new Invalid({ message: "Deepgram does not expose a supported transcription model catalog; enter a model ID manually" })
        if (input.provider === "openai-compatible" && !input.baseURL) return yield* new Invalid({ message: "An endpoint is required for model discovery" })
        const credential = input.connection?.type === "credential" ? yield* credentials.get(input.connection.id) : undefined
        const key = input.connection?.type === "env" ? process.env[input.connection.name] : credential?.value.type === "key" ? credential.value.key : undefined
        if (input.connection && !key) return yield* new Invalid({ message: "The selected voice connection is unavailable" })
        if (!key && input.provider !== "openai-compatible") return yield* new Invalid({ message: "Choose an explicit voice API key before discovering models" })
        const base = input.baseURL ?? (input.provider === "elevenlabs" ? "https://api.elevenlabs.io/v1" : input.provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1")
        const endpoint = input.provider === "elevenlabs" ? new URL("/v1/models", base) : new URL(`${base.replace(/\/$/, "")}/models`)
        if (input.provider === "openrouter") endpoint.searchParams.set("output_modalities", "transcription")
        const models = yield* Effect.tryPromise({
          try: async (signal) => {
            const headers: Record<string, string> = {}
            if (key) headers[input.provider === "elevenlabs" ? "xi-api-key" : "authorization"] = input.provider === "elevenlabs" ? key : `Bearer ${key}`
            const response = await fetch(endpoint, { headers, redirect: "error", signal })
            if (!response.ok) throw new TokenRequestError(response.status)
            const json: unknown = await response.json()
            const list = Array.isArray(json) ? json : json && typeof json === "object" && "data" in json && Array.isArray(json.data) ? json.data : undefined
            if (!list) throw new TokenResponseError()
            return list.flatMap((item: unknown) => {
              if (!item || typeof item !== "object") return []
              const entry = item as Record<string, unknown>
              const id = input.provider === "elevenlabs" ? entry.model_id : entry.id
              if (typeof id !== "string" || !id) return []
              if (input.provider === "elevenlabs" && !id.toLowerCase().startsWith("scribe")) return []
              if (input.provider === "openai" && !/(transcribe|whisper)/i.test(id)) return []
              if (input.provider === "openrouter") {
                const architecture = entry.architecture
                if (!architecture || typeof architecture !== "object" || !("output_modalities" in architecture) || !Array.isArray(architecture.output_modalities) || !architecture.output_modalities.includes("transcription")) return []
              }
              return [{ id, name: typeof entry.name === "string" && entry.name ? entry.name : id }]
            })
          },
          catch: (error) => new Unavailable({ message: error instanceof TokenRequestError ? `Model discovery: GET ${endpoint.origin}${endpoint.pathname} — HTTP ${error.status}. ${statusAdvice(error.status)}` : error instanceof TokenResponseError ? "Model discovery returned an invalid response." : `Model discovery failed before an HTTP response from ${endpoint.origin}${endpoint.pathname}. Check DNS, TLS, proxy and firewall on the Redcode server.` }),
        }).pipe(Effect.timeoutOrElse({ duration: "15 seconds", orElse: () => Effect.fail(new Unavailable({ message: "Model discovery timed out" })) }))
        return models
      }),
      realtime: Effect.fn("Voice.realtime")(function* () {
        const settings = Config.latest(yield* config.entries(), "voice")
        if (!settings || settings.provider !== "elevenlabs" || settings.mode !== "realtime")
          return yield* new Invalid({ message: "Enable ElevenLabs realtime dictation in Voice settings" })
        if (settings.baseURL && !validEndpoint(settings.baseURL))
          return yield* new Invalid({ message: "Dictation requires an HTTPS endpoint, or HTTP on localhost" })
        const credential = settings.connection?.type === "credential" ? yield* credentials.get(settings.connection.id) : undefined
        const key = settings.connection?.type === "env" ? process.env[settings.connection.name] : credential?.value.type === "key" ? credential.value.key : undefined
        if (!key) return yield* new Invalid({ message: "Choose an explicit ElevenLabs voice API key" })
        const base = new URL(settings.baseURL ?? "https://api.elevenlabs.io")
        const endpoint = new URL("/v1/single-use-token/realtime_scribe", base)
        const token = yield* Effect.tryPromise({
          try: async (signal) => {
            const response = await fetch(endpoint, { method: "POST", headers: { "xi-api-key": key }, redirect: "error", signal })
            if (!response.ok) throw new TokenRequestError(response.status)
            const data: unknown = await response.json().catch(() => { throw new TokenResponseError() })
            if (!data || typeof data !== "object" || !("token" in data) || typeof data.token !== "string" || !data.token)
              throw new TokenResponseError()
            return data.token
          },
          catch: (error) => new Unavailable({ message: tokenDiagnostic(endpoint, error) }),
        }).pipe(Effect.timeoutOrElse({ duration: "15 seconds", orElse: () => Effect.fail(new Unavailable({ message: "Realtime dictation timed out" })) }))
        base.protocol = base.protocol === "https:" ? "wss:" : "ws:"
        base.pathname = "/v1/speech-to-text/realtime"
        return { token, url: base.toString(), ...(settings.language ? { language: settings.language } : {}) }
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
        const options = { auth, ...(settings.baseURL ? { baseURL: settings.baseURL } : settings.provider === "openrouter" ? { baseURL: "https://openrouter.ai/api/v1" } : {}) }
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
          // Dictation is inserted into a coding prompt, so ambient sound annotations are not useful text.
          ...(settings.provider === "elevenlabs" ? { providerOptions: { tag_audio_events: false } } : {}),
        }).pipe(
          Effect.provide(TranscriptionClient.layer),
          Effect.provideService(RequestExecutor.Service, executor),
          Effect.timeout("90 seconds"),
          Effect.tapError((error) =>
            Effect.logWarning("dictation request failed", { provider: settings.provider, reason: error._tag }),
          ),
          Effect.mapError((error) => new Unavailable({ message: transcriptionDiagnostic(settings, error) })),
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

class TokenRequestError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`) }
}

class TokenResponseError extends Error {}

function statusAdvice(status: number) {
  if (status === 401) return "Authentication rejected; check the selected API key."
  if (status === 403) return "Access denied; check key permissions, account restrictions and network policy."
  if (status === 404) return "Endpoint not found; check the base URL and provider."
  if (status === 429) return "Rate limit or quota exceeded; check provider limits and billing."
  if (status >= 500) return "The endpoint or an intermediate proxy returned a server error; retry and inspect the network."
  return "Check the provider configuration and endpoint."
}

function tokenDiagnostic(endpoint: URL, error: unknown) {
  const destination = `${endpoint.origin}${endpoint.pathname}`
  if (error instanceof TokenRequestError)
    return `ElevenLabs realtime token request: POST ${destination} — HTTP ${error.status}. ${statusAdvice(error.status)}`
  if (error instanceof TokenResponseError)
    return `ElevenLabs realtime token request: POST ${destination} returned an invalid token response. Check the endpoint and any intermediate proxy.`
  return `ElevenLabs realtime token request: POST ${destination} failed before an HTTP response. Check DNS, TLS, proxy and firewall access from the Redcode server.`
}

function transcriptionDiagnostic(settings: Voice.Settings, error: unknown) {
  const destination = settings.provider === "elevenlabs"
    ? `${new URL(settings.baseURL ?? "https://api.elevenlabs.io").origin}/v1/speech-to-text`
    : settings.baseURL ? new URL(settings.baseURL).origin : settings.provider
  const prefix = `Dictation (${settings.provider}, model ${settings.model}): POST ${destination}`
  if (!(error instanceof AIError)) return `${prefix} failed or timed out. Check server logs and network access.`
  const reason = error.reason
  if (reason.message === "Requests using this provider account are waiting for recovery; retry after the shared cooldown.")
    return `${prefix} — Redcode provider cooldown after a previous rate limit or server failure; wait and retry.`
  if (reason.http) return `${prefix} — HTTP ${reason.http.status}, ${reason._tag}. ${statusAdvice(reason.http.status)}`
  if (reason._tag === "Transport") {
    const code = reason.code && /^[A-Za-z0-9_-]{1,40}$/.test(reason.code) ? ` (${reason.code})` : ""
    return `${prefix} — transport ${reason.operation}${code}; no HTTP response. Check DNS, TLS, proxy and firewall access from the Redcode server.`
  }
  return `${prefix} — ${reason._tag}. Check provider configuration and server logs.`
}
