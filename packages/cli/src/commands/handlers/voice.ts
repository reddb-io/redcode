import { select, text, password, isCancel, log } from "@clack/prompts"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Credential } from "@opencode/schema/credential"
import { Voice } from "@opencode/schema/voice"
import { startVoiceCapture } from "@opencode/tui/util/voice-capture"
import { openUrl } from "@opencode/util/open"
import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"

export default Runtime.handler(
  Commands.commands.voice,
  Effect.fn("cli.voice")(function* (input) {
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
      mismatch: "ignore",
    })
    const api = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
    if (input.setup) {
      if (!process.stdin.isTTY) return yield* Effect.fail(new Error("Voice setup requires an interactive terminal"))
      const saved = yield* Effect.tryPromise(() => api.voice.connections())
      const provider = yield* Effect.promise(() =>
        select<Voice.Settings["provider"]>({
          message: "Transcription provider",
          options: [
            { value: "openai", label: "OpenAI" },
            { value: "elevenlabs", label: "ElevenLabs" },
            { value: "deepgram", label: "Deepgram" },
            { value: "openai-compatible", label: "OpenAI-compatible endpoint" },
          ],
        }),
      )
      if (isCancel(provider)) return
      const connections = saved.map((connection) => ({ value: connection.id, label: connection.label }))
      const connection = yield* Effect.promise(() =>
        select({
          message: "Dictation connection",
          options: [
            ...(provider === "openai-compatible" ? [{ value: "", label: "No key (local endpoint)" }] : []),
            ...connections,
            { value: "new", label: "Add a voice API key…" },
          ],
        }),
      )
      if (isCancel(connection)) return
      const added =
        connection === "new"
          ? yield* Effect.gen(function* () {
              const label = yield* Effect.promise(() =>
                text({
                  message: "Voice connection name",
                  validate: (value) => (!value?.trim() ? "Name is required" : undefined),
                }),
              )
              if (isCancel(label)) return
              const key = yield* Effect.promise(() =>
                password({
                  message: "Voice API key",
                  validate: (value) => (!value?.trim() ? "Key is required" : undefined),
                }),
              )
              if (isCancel(key)) return
              return yield* Effect.tryPromise(() => api.voice.connect({ label: label.trim(), key: key.trim() }))
            })
          : undefined
      if (connection === "new" && !added) return
      const model = yield* Effect.promise(() =>
        text({
          message: "Transcription model",
          initialValue:
            provider === "elevenlabs" ? "scribe_v2" : provider === "deepgram" ? "nova-3" : "gpt-4o-mini-transcribe",
          validate: (value) => (!value?.trim() ? "Model is required" : undefined),
        }),
      )
      if (isCancel(model)) return
      const endpoint = yield* Effect.promise(() =>
        text({
          message: "Endpoint URL (empty for the provider default)",
          validate: (value) =>
            provider === "openai-compatible" && !value?.trim() ? "Endpoint is required" : undefined,
        }),
      )
      if (isCancel(endpoint)) return
      const language = yield* Effect.promise(() =>
        text({ message: "Language code (empty for automatic detection)", placeholder: "pt" }),
      )
      if (isCancel(language)) return
      const settings: Voice.Settings = {
        provider,
        model: model.trim(),
        ...(connection ? { connection: { type: "credential", id: Credential.ID.make(added?.id ?? connection) } } : {}),
        ...(endpoint.trim() ? { baseURL: endpoint.trim() } : {}),
        ...(language.trim() ? { language: language.trim() } : {}),
      }
      yield* Effect.tryPromise(() => api.config.update({ voice: settings }))
      log.success("Voice settings saved. Use redcode voice or /voice in the TUI.")
      return
    }
    const entries = yield* Effect.tryPromise(() => api.config.get())
    if (!entries.some((entry) => entry.type === "document" && entry.info.voice))
      return yield* Effect.fail(new Error("Choose a dictation provider with redcode voice --setup first"))
    const capture = startVoiceCapture({
      signal: new AbortController().signal,
      transcribe: async (audio, signal) => (await api.voice.transcribe({ audio }, { signal })).text,
      accept: (value) => {
        process.stdout.write(value + "\n")
        return true
      },
    })
    yield* Effect.addFinalizer(() => Effect.sync(capture.cancel))
    process.stderr.write(`Voice recorder: ${capture.url}\n`)
    if (!input.noOpen) yield* Effect.tryPromise(() => openUrl(capture.url)).pipe(Effect.orElseSucceed(() => undefined))
    yield* Effect.promise(() => capture.result)
  }),
)
