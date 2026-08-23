import { decode, encode } from "@reddb-io/toon"
import type { AnyMessage } from "@agentclientprotocol/sdk"

export const AcpToonMaxFrameBytes = 1024 * 1024

export function toonStream(output: WritableStream<Uint8Array>, input: ReadableStream<Uint8Array>) {
  const encoder = new TextEncoder()
  const writer = output.getWriter()
  const writable = new WritableStream<AnyMessage>({
    async write(message) {
      const { jsonrpc: _jsonrpc, toonrpc: _toonrpc, ...rest } = message as unknown as Record<string, unknown>
      const frame = encoder.encode(`${encode({ toonrpc: "1.0", ...rest })}\n\n`)
      if (frame.byteLength > AcpToonMaxFrameBytes) throw new Error("ACP TOON frame exceeds 1 MiB")
      await writer.write(frame)
    },
    close: () => writer.close(),
    abort: (reason) => writer.abort(reason),
  })

  const reader = input.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let buffer = ""
  let resolveClosed: () => void
  let rejectClosed: (error: unknown) => void
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve
    rejectClosed = reject
  })

  const readable = new ReadableStream<AnyMessage>({
    start(controller) {
      void pump(controller)
    },
    cancel: (reason) => reader.cancel(reason),
  })

  async function pump(controller: ReadableStreamDefaultController<AnyMessage>) {
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true })
        drain(controller)
        if (encoder.encode(buffer).byteLength > AcpToonMaxFrameBytes) throw new Error("ACP TOON frame exceeds 1 MiB")
      }
      buffer += decoder.decode()
      drain(controller)
      if (buffer.trim().length > 0) throw new Error("Incomplete ACP TOON frame")
      controller.close()
      resolveClosed()
    } catch (error) {
      await reader.cancel(error).catch(() => undefined)
      rejectClosed(error)
      controller.error(error)
    } finally {
      reader.releaseLock()
    }
  }

  function drain(controller: ReadableStreamDefaultController<AnyMessage>) {
    while (true) {
      const start = buffer.search(/[^\r\n]/)
      if (start < 0) {
        buffer = ""
        return
      }
      buffer = buffer.slice(start)
      const match = /\r?\n\r?\n/.exec(buffer)
      if (!match) return
      const frame = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      if (encoder.encode(frame).byteLength > AcpToonMaxFrameBytes) throw new Error("ACP TOON frame exceeds 1 MiB")
      if (frame.trimStart().startsWith("{")) throw new Error("JSON frames are not accepted in ACP TOON mode")

      const value = decode(frame)
      if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new Error('Invalid ACP TOON frame: expected toonrpc "1.0"')
      const message = value as Record<string, unknown>
      if (message.toonrpc !== "1.0") throw new Error('Invalid ACP TOON frame: expected toonrpc "1.0"')
      const { toonrpc: _toonrpc, jsonrpc: _jsonrpc, ...rest } = message
      controller.enqueue({ jsonrpc: "2.0", ...rest } as AnyMessage)
    }
  }

  return { writable, readable, closed }
}
