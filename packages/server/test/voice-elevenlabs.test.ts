import { expect } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { startServer } from "./fixture/server"

it.live(
  "ElevenLabs dictation sends WAV, explicit voice key and language to Scribe",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("redcode-scribe-")))
      const calls: unknown[] = []
      const tokens: unknown[] = []
      let failure = 0
      const upstream = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          if (failure) return new Response("sensitive upstream body fixture-scribe-key", { status: failure })
          if (new URL(request.url).pathname === "/v1/single-use-token/realtime_scribe") {
            tokens.push({ key: request.headers.get("xi-api-key"), method: request.method })
            return Response.json({ token: "single-use-test-token" })
          }
          const form = await request.formData()
          const file = form.get("file")
          calls.push({
            path: new URL(request.url).pathname,
            key: request.headers.get("xi-api-key"),
            authorization: request.headers.get("authorization"),
            model: form.get("model_id"),
            language: form.get("language_code"),
            events: form.get("tag_audio_events"),
            type: file instanceof File ? file.type : undefined,
            size: file instanceof File ? file.size : 0,
          })
          return Response.json({ text: "  implemente essa função  ", language_code: "por", words: [] })
        },
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => upstream.stop(true)))
      const server = yield* startServer(tmp.path)
      const request = (route: string, body: unknown, method = "POST") => {
        const url = new URL(route, server.base)
        url.searchParams.set("location[directory]", tmp.path)
        return fetch(url, {
          method,
          headers: { ...server.headers, "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      }
      const saved = yield* Effect.promise(() =>
        request("/api/voice/connections", { label: "Scribe", key: "fixture-scribe-key" }),
      )
      expect(saved.status).toBe(200)
      const connection = (yield* Effect.promise(() => saved.json())) as { data: { id: string } }
      expect(
        (yield* Effect.promise(() =>
          request(
            "/api/experimental/config",
            {
              voice: {
                provider: "elevenlabs",
                model: "scribe_v2",
                baseURL: upstream.url.toString(),
                language: "pt",
                connection: { type: "credential", id: connection.data.id },
              },
            },
            "PATCH",
          ),
        )).status,
      ).toBe(204)
      const audio = Buffer.alloc(3244)
      audio.write("RIFF")
      audio.writeUInt32LE(audio.length - 8, 4)
      audio.write("WAVEfmt ", 8)
      audio.writeUInt32LE(16, 16)
      audio.writeUInt16LE(1, 20)
      audio.writeUInt16LE(1, 22)
      audio.writeUInt32LE(16_000, 24)
      audio.writeUInt32LE(32_000, 28)
      audio.writeUInt16LE(2, 32)
      audio.writeUInt16LE(16, 34)
      audio.write("data", 36)
      audio.writeUInt32LE(audio.length - 44, 40)
      const result = yield* Effect.promise(() => request("/api/voice/transcribe", { audio: audio.toString("base64") }))
      expect(result.status).toBe(200)
      expect(yield* Effect.promise(() => result.json())).toEqual({ data: { text: "implemente essa função" } })
      expect(calls).toEqual([
        {
          path: "/v1/speech-to-text",
          key: "fixture-scribe-key",
          authorization: null,
          model: "scribe_v2",
          language: "pt",
          events: "false",
          type: expect.stringMatching(/^audio\/(?:x-)?wav$/),
          size: audio.length,
        },
      ])
      for (const status of [401, 403, 502, 429]) {
        failure = status
        const rejected = yield* Effect.promise(() => request("/api/voice/transcribe", { audio: audio.toString("base64") }))
        expect(rejected.status).toBe(503)
        const body = yield* Effect.promise(() => rejected.text())
        expect(body).toContain(`HTTP ${status}`)
        expect(body).toContain("/v1/speech-to-text")
        expect(body).not.toContain("fixture-scribe-key")
        expect(body).not.toContain("sensitive upstream body")
      }
      failure = 0
      const batchToken = yield* Effect.promise(() => request("/api/voice/realtime", {}))
      expect(batchToken.status).toBe(400)
      expect(tokens).toEqual([])
      expect((yield* Effect.promise(() => request("/api/experimental/config", {
        voice: { provider: "elevenlabs", mode: "realtime", model: "scribe_v2", baseURL: upstream.url.toString(), language: "pt", connection: { type: "credential", id: connection.data.id } },
      }, "PATCH"))).status).toBe(204)
      const access = yield* Effect.promise(() => request("/api/voice/realtime", {}))
      expect(access.status).toBe(200)
      const resultAccess = yield* Effect.promise(() => access.json())
      expect(resultAccess).toEqual({ data: { token: "single-use-test-token", url: `ws://${upstream.url.host}/v1/speech-to-text/realtime`, language: "pt" } })
      expect(JSON.stringify(resultAccess)).not.toContain("fixture-scribe-key")
      expect(tokens).toEqual([{ key: "fixture-scribe-key", method: "POST" }])
      failure = 403
      const denied = yield* Effect.promise(() => request("/api/voice/realtime", {}))
      expect(denied.status).toBe(503)
      const deniedBody = yield* Effect.promise(() => denied.text())
      expect(deniedBody).toContain("HTTP 403")
      expect(deniedBody).toContain("/v1/single-use-token/realtime_scribe")
      expect(deniedBody).not.toContain("fixture-scribe-key")
      expect((yield* Effect.promise(() => request("/api/experimental/config", {
        voice: { provider: "elevenlabs", mode: "realtime", model: "scribe_v2", baseURL: "http://127.0.0.1:1", connection: { type: "credential", id: connection.data.id } },
      }, "PATCH"))).status).toBe(204)
      const unreachable = yield* Effect.promise(() => request("/api/voice/transcribe", { audio: audio.toString("base64") }))
      expect(unreachable.status).toBe(503)
      const unreachableBody = yield* Effect.promise(() => unreachable.text())
      expect(unreachableBody).toContain("no HTTP response")
      expect(unreachableBody).toContain("127.0.0.1:1")
      expect(unreachableBody).not.toContain("fixture-scribe-key")
      expect((yield* Effect.promise(() => request("/api/experimental/config", {
        voice: { provider: "elevenlabs", mode: "realtime", model: "scribe_v2" },
      }, "PATCH"))).status).toBe(204)
      const configURL = new URL("/api/config", server.base)
      configURL.searchParams.set("location[directory]", tmp.path)
      const config = yield* Effect.promise(() => fetch(configURL, { headers: server.headers }))
      const configBody = yield* Effect.promise(() => config.json())
      expect(JSON.stringify(configBody)).not.toContain(connection.data.id)
    }),
  { timeout: 60_000 },
)
