import { describe, expect, test } from "bun:test"
import { decode, encode } from "@reddb-io/toon"
import { AcpToonMaxFrameBytes, toonStream } from "../../src/acp/toon-stream"

describe("ACP TOON stream", () => {
  test("decodes TOON requests and encodes TOON responses", async () => {
    const request = encode({ toonrpc: "1.0", method: "initialize", params: {}, id: 1 }) + "\n\n"
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(request))
        controller.close()
      },
    })
    const output = new TransformStream<Uint8Array, Uint8Array>()
    const stream = toonStream(output.writable, input)

    const incoming = await stream.readable.getReader().read()
    expect(incoming.value).toEqual({ jsonrpc: "2.0", method: "initialize", params: {}, id: 1 })
    await stream.closed

    const read = output.readable.getReader().read()
    const writer = stream.writable.getWriter()
    await writer.write({ jsonrpc: "2.0", result: { ok: true }, id: 1 })
    const frame = await read
    expect(decode(new TextDecoder().decode(frame.value))).toEqual({
      toonrpc: "1.0",
      result: { ok: true },
      id: 1,
    })
  })

  test("rejects JSON frames and cancels the underlying input", async () => {
    let cancelled = false
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0","method":"initialize","id":1}\n\n'))
      },
      cancel() {
        cancelled = true
      },
    })
    const stream = toonStream(new WritableStream(), input)
    const closed = expect(stream.closed).rejects.toThrow("JSON frames are not accepted")

    await expect(stream.readable.getReader().read()).rejects.toThrow("JSON frames are not accepted")
    await closed
    expect(cancelled).toBe(true)
  })

  test("rejects oversized frames and cancels the underlying input", async () => {
    let cancelled = false
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(AcpToonMaxFrameBytes + 1).fill(97))
      },
      cancel() {
        cancelled = true
      },
    })
    const stream = toonStream(new WritableStream(), input)
    const closed = expect(stream.closed).rejects.toThrow("exceeds 1 MiB")

    await expect(stream.readable.getReader().read()).rejects.toThrow("exceeds 1 MiB")
    await closed
    expect(cancelled).toBe(true)
  })
})
