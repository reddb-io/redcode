import { expect } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { startServer } from "./fixture/server"

it.live(
  "dictation uses only its configured endpoint and preserves unrelated global settings",
  () =>
    Effect.gen(function* () {
      const previous = process.env.OPENAI_API_KEY
      process.env.OPENAI_API_KEY = "fixture-ambient-key-not-authorized"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.OPENAI_API_KEY
          if (previous !== undefined) process.env.OPENAI_API_KEY = previous
        }),
      )
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("redcode-voice-")))
      const calls: { path: string; authorization: string | null; model: FormDataEntryValue | null; size: number }[] = []
      const upstream = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const form = await request.formData()
          const audio = form.get("file")
          calls.push({
            path: new URL(request.url).pathname,
            authorization: request.headers.get("authorization"),
            model: form.get("model"),
            size: audio instanceof File ? audio.size : 0,
          })
          return Response.json({ text: "  spoken draft  " })
        },
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => upstream.stop(true)))
      yield* Effect.promise(() => Bun.write(`${tmp.path}/opencode.json`, '{"shell":"fixture-shell"}'))
      const server = yield* startServer(tmp.path)
      const audio = Buffer.alloc(364)
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
      audio.writeUInt32LE(320, 40)
      const request = (route: string, body: unknown, method = "POST") => {
        const url = new URL(route, server.base)
        url.searchParams.set("location[directory]", tmp.path)
        return fetch(url, {
          method,
          headers: { ...server.headers, "content-type": "application/json" },
          body: method === "GET" ? undefined : JSON.stringify(body),
        })
      }
      const unconfigured = yield* Effect.promise(() =>
        request("/api/voice/transcribe", { audio: audio.toString("base64") }),
      )
      expect({ status: unconfigured.status, body: yield* Effect.promise(() => unconfigured.text()) }).toMatchObject({
        status: 400,
      })
      const settings = { provider: "openai-compatible", model: "whisper-1", baseURL: `${upstream.url}v1` }
      expect(
        (yield* Effect.promise(() => request("/api/experimental/config", { voice: settings }, "PATCH"))).status,
      ).toBe(204)
      expect(yield* Effect.promise(() => Bun.file(`${tmp.path}/opencode.json`).json())).toEqual({
        shell: "fixture-shell",
        voice: settings,
      })
      const response = yield* Effect.promise(() =>
        request("/api/voice/transcribe", { audio: audio.toString("base64") }),
      )
      const body = yield* Effect.promise(() => response.json())
      expect({ status: response.status, body }).toEqual({ status: 200, body: { data: { text: "spoken draft" } } })
      expect(calls).toEqual([
        { path: "/v1/audio/transcriptions", authorization: null, model: "whisper-1", size: audio.length },
      ])
      expect((yield* Effect.promise(() => request("/api/voice/transcribe", { audio: "not audio" }))).status).toBe(400)
      expect(calls).toHaveLength(1)
      const bound = { ...settings, provider: "openai", connection: { type: "env", name: "OPENAI_API_KEY" } }
      expect((yield* Effect.promise(() => request("/api/experimental/config", { voice: bound }, "PATCH"))).status).toBe(
        204,
      )
      expect(
        (yield* Effect.promise(() => request("/api/voice/transcribe", { audio: audio.toString("base64") }))).status,
      ).toBe(200)
      expect(calls.at(-1)?.authorization).toBe("Bearer fixture-ambient-key-not-authorized")
      const coding = yield* Effect.promise(() =>
        request("/api/credential", {
          integrationID: "openai",
          label: "Coding account",
          value: { type: "key", key: "fixture-coding-key" },
        }).then((response) => response.json()),
      )
      const added = yield* Effect.promise(() =>
        request("/api/voice/connections", {
          label: "Dictation",
          key: "fixture-voice-key",
        }).then((response) => response.json()),
      )
      expect(added).toEqual({ data: { id: expect.any(String), label: "Dictation", integrationID: "redcode-voice" } })
      const saved = yield* Effect.promise(() =>
        request("/api/voice/connections", undefined, "GET").then((response) => response.json()),
      )
      expect(saved.data).toContainEqual(added.data)
      expect(JSON.stringify(saved)).not.toContain("fixture-voice-key")
      expect(JSON.stringify(saved)).not.toContain("fixture-coding-key")
      const accounts = yield* Effect.promise(() =>
        request("/api/credential", undefined, "GET").then((response) => response.json()),
      )
      expect(accounts.data.find((entry: { id: string }) => entry.id === coding.data.id)?.active).toBe(true)
      expect(
        (yield* Effect.promise(() =>
          request(
            "/api/experimental/config",
            {
              voice: { ...settings, connection: { type: "credential", id: added.data.id } },
            },
            "PATCH",
          ),
        )).status,
      ).toBe(204)
      expect(
        (yield* Effect.promise(() => request("/api/voice/transcribe", { audio: audio.toString("base64") }))).status,
      ).toBe(200)
      expect(calls.at(-1)?.authorization).toBe("Bearer fixture-voice-key")
    }),
  { timeout: 60_000 },
)
