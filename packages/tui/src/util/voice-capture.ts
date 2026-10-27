import { Schema, Option } from "effect"
import { Voice } from "@opencode/schema/voice"
import { voicePage } from "./voice-page"

const decodeAudio = Schema.decodeUnknownOption(Schema.Struct({ audio: Voice.Audio }))
const decodeText = Schema.decodeUnknownOption(
  Schema.Struct({ text: Schema.String.pipe(Schema.check(Schema.isMaxLength(128_000))) }),
)

/** A single-use, loopback-only bridge; the browser never receives server credentials. */
export function startVoiceCapture(input: {
  signal: AbortSignal
  transcribe: (audio: string, signal: AbortSignal) => Promise<string>
  accept: (text: string) => boolean
}) {
  const token = crypto.randomUUID()
  const result = Promise.withResolvers<boolean>()
  const lifetime = new AbortController()
  let transcribing = false
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 12_804_096,
    idleTimeout: 120,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.host !== server.url.host) return new Response(null, { status: 403 })
      if (request.method === "GET" && url.pathname === "/")
        return new Response(voicePage(), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy":
              "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
            "Permissions-Policy": "microphone=(self), camera=()",
          },
        })
      if (
        request.method !== "POST" ||
        request.headers.get("authorization") !== `Bearer ${token}` ||
        request.headers.get("origin") !== server.url.origin
      )
        return new Response(null, { status: 403 })
      if (url.pathname === "/cancel") {
        cancel()
        return Response.json({})
      }
      const json: unknown = await request.json().catch(() => undefined)
      if (url.pathname === "/accept") {
        const decoded = decodeText(json)
        if (Option.isNone(decoded) || !decoded.value.text.trim()) return new Response(null, { status: 400 })
        if (!input.accept(decoded.value.text.trim())) return new Response(null, { status: 409 })
        result.resolve(true)
        close()
        return Response.json({})
      }
      if (url.pathname !== "/transcribe") return new Response(null, { status: 404 })
      const decoded = decodeAudio(json)
      if (Option.isNone(decoded)) return new Response(null, { status: 400 })
      if (transcribing) return new Response(null, { status: 409 })
      transcribing = true
      return input
        .transcribe(decoded.value.audio, AbortSignal.any([lifetime.signal, request.signal]))
        .then(
          (text) => Response.json({ text }),
          () => new Response(null, { status: 502 }),
        )
        .finally(() => {
          transcribing = false
        })
    },
  })
  const close = () => {
    clearTimeout(timer)
    lifetime.abort()
    input.signal.removeEventListener("abort", cancel)
    void server.stop(false)
  }
  const cancel = () => {
    result.resolve(false)
    close()
  }
  const timer = setTimeout(cancel, 600_000)
  input.signal.addEventListener("abort", cancel, { once: true })
  if (input.signal.aborted) cancel()
  return { url: `${server.url}#${token}`, result: result.promise, cancel }
}
