import { expect } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { startServer } from "./fixture/server"

it.live("discovers OpenRouter transcription models and transcribes using the explicitly selected key", () => Effect.gen(function* () {
  const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("redcode-voice-models-")))
  const calls: { path: string; query: string; auth: string | null; model?: unknown }[] = []
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.endsWith("/models")) {
      if (request.headers.has("xi-api-key")) return Response.json([
        { model_id: "scribe_v2", name: "Scribe v2" },
        { model_id: "eleven_turbo_v2", name: "Turbo" },
      ])
      calls.push({ path: url.pathname, query: url.search, auth: request.headers.get("authorization") })
      return Response.json({ data: [
        { id: "speech/model", name: "Speech model", architecture: { output_modalities: ["transcription"] } },
        { id: "chat/audio", name: "Audio chat", architecture: { output_modalities: ["text"] } },
      ] })
    }
    const form = await request.formData()
    calls.push({ path: url.pathname, query: url.search, auth: request.headers.get("authorization"), model: form.get("model") })
    return Response.json({ text: "spoken text" })
  } })
  yield* Effect.addFinalizer(() => Effect.promise(() => upstream.stop(true)))
  const server = yield* startServer(tmp.path)
  const request = (route: string, body: unknown, method = "POST") => {
    const url = new URL(route, server.base)
    url.searchParams.set("location[directory]", tmp.path)
    return fetch(url, { method, headers: { ...server.headers, "content-type": "application/json" }, body: JSON.stringify(body) })
  }
  const saved = yield* Effect.promise(() => request("/api/voice/connections", { label: "OpenRouter", key: "voice-test-secret" }))
  const credential = (yield* Effect.promise(() => saved.json())) as { data: { id: string } }
  const input = { provider: "openrouter", connection: { type: "credential", id: credential.data.id }, baseURL: `${upstream.url}v1` }
  const discovery = yield* Effect.promise(() => request("/api/voice/models", input))
  expect(discovery.status).toBe(200)
  expect(yield* Effect.promise(() => discovery.json())).toEqual({ data: [{ id: "speech/model", name: "Speech model" }] })
  expect(calls[0]).toEqual({ path: "/v1/models", query: "?output_modalities=transcription", auth: "Bearer voice-test-secret" })
  const missing = yield* Effect.promise(() => request("/api/voice/models", { provider: "openrouter" }))
  expect(missing.status).toBe(400)
  expect((yield* Effect.promise(() => request("/api/experimental/config", { voice: { ...input, model: "speech/model" } }, "PATCH"))).status).toBe(204)
  const audio = Buffer.alloc(3244)
  audio.write("RIFF"); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVEfmt ", 8)
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28); audio.writeUInt16LE(2, 32)
  audio.writeUInt16LE(16, 34); audio.write("data", 36); audio.writeUInt32LE(audio.length - 44, 40)
  const transcript = yield* Effect.promise(() => request("/api/voice/transcribe", { audio: audio.toString("base64") }))
  expect(transcript.status).toBe(200)
  expect(yield* Effect.promise(() => transcript.json())).toEqual({ data: { text: "spoken text" } })
  expect(calls[1]).toEqual({ path: "/v1/audio/transcriptions", query: "", auth: "Bearer voice-test-secret", model: "speech/model" })
  const eleven = yield* Effect.promise(() => request("/api/voice/models", { ...input, provider: "elevenlabs", baseURL: upstream.url.toString() }))
  expect(eleven.status).toBe(200)
  expect(yield* Effect.promise(() => eleven.json())).toEqual({ data: [{ id: "scribe_v2", name: "Scribe v2" }] })
}), { timeout: 60_000 })
