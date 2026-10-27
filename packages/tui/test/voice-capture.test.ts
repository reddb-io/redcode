import { expect, test } from "bun:test"
import { startVoiceCapture } from "../src/util/voice-capture"

test("the local recorder authenticates delivery and keeps a changed draft recoverable", async () => {
  const controller = new AbortController()
  const received: string[] = []
  let ready = false
  const capture = startVoiceCapture({
    signal: controller.signal,
    transcribe: async () => "spoken",
    accept: (text) => {
      if (!ready) return false
      received.push(text)
      return true
    },
  })
  const url = new URL(capture.url)
  const headers = {
    authorization: `Bearer ${url.hash.slice(1)}`,
    origin: url.origin,
    "content-type": "application/json",
  }
  try {
    const page = await fetch(url)
    expect(page.headers.get("permissions-policy")).toBe("microphone=(self), camera=()")
    expect((await page.text()).includes(url.hash.slice(1))).toBe(false)
    const send = (route: string, value: unknown, extra = headers) =>
      fetch(new URL(route, url), { method: "POST", headers: extra, body: JSON.stringify(value) })
    expect((await send("/accept", { text: "bad" }, { ...headers, origin: "https://untrusted.test" })).status).toBe(403)
    expect((await send("/accept", { text: "bad" }, { ...headers, authorization: "Bearer wrong" })).status).toBe(403)
    expect((await send("/accept", { text: "spoken" })).status).toBe(409)
    expect(received).toEqual([])
    ready = true
    expect((await send("/accept", { text: "reviewed spoken text" })).status).toBe(200)
    expect(await capture.result).toBe(true)
    expect(received).toEqual(["reviewed spoken text"])
  } finally {
    controller.abort()
    capture.cancel()
  }
})
