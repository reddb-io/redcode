import { expect, test } from "bun:test"
import { VoiceRealtime } from "./voice-realtime.js"

test("streams PCM, reports partials, and commits the final transcript", async () => {
  const frames: unknown[] = []
  const updates: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request, server) { return server.upgrade(request) ? undefined : new Response(null, { status: 400 }) },
    websocket: {
      open(socket) { socket.send(JSON.stringify({ message_type: "session_started" })) },
      message(socket, value) {
        const frame = JSON.parse(String(value))
        frames.push(frame)
        if (frame.commit) socket.send(JSON.stringify({ message_type: "committed_transcript", text: "olá mundo" }))
        else socket.send(JSON.stringify({ message_type: "partial_transcript", text: "olá" }))
      },
    },
  })
  try {
    const client = new VoiceRealtime((text) => updates.push(text))
    const controller = new AbortController()
    await client.start({ token: "single-use", url: `ws://${server.url.host}/voice`, language: "pt" }, controller.signal)
    client.send(new Uint8Array([1, 2, 3, 4]))
    await Bun.sleep(50)
    expect(updates).toContain("olá")
    expect(await client.finish()).toEqual({ text: "olá mundo", complete: true })
    expect(frames).toEqual([
      { message_type: "input_audio_chunk", audio_base_64: "AQIDBA==", sample_rate: 16000 },
      { message_type: "input_audio_chunk", audio_base_64: "", sample_rate: 16000, commit: true },
    ])
  } finally { await server.stop(true) }
})

test("waits for an earlier segment before confirming the final segment", async () => {
  let commits = 0
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request, server) { return server.upgrade(request) ? undefined : new Response(null, { status: 400 }) },
    websocket: {
      open(socket) { socket.send(JSON.stringify({ message_type: "session_started" })) },
      message(socket, value) {
        const frame = JSON.parse(String(value))
        if (!frame.commit) return
        const segment = ++commits
        setTimeout(() => socket.send(JSON.stringify({ message_type: "committed_transcript", text: segment === 1 ? "primeira parte" : "final" })), segment === 1 ? 50 : 0)
      },
    },
  })
  try {
    const client = new VoiceRealtime(() => {})
    await client.start({ token: "one-use", url: `ws://${server.url.host}/voice` }, new AbortController().signal)
    client.send(new Uint8Array(160_000))
    client.send(new Uint8Array([1, 2]))
    expect(await client.finish()).toEqual({ text: "primeira parte final", complete: true })
    expect(commits).toBe(2)
  } finally { await server.stop(true) }
})
