export * as BrowserTunnelSocket from "./websocket.js"

import { WebSocket, WebSocketServer } from "ws"
import { BrowserTunnelHost } from "./tunnel-host.js"
import { StreamWire } from "./stream-wire.js"

export type Socket = WebSocket

export function makeServer() {
  return new WebSocketServer({
    noServer: true,
    maxPayload: StreamWire.MAX_WS_FRAME_BYTES,
    perMessageDeflate: false,
  })
}

export function adapt(ws: WebSocket): BrowserTunnelHost.BinarySocket {
  ws.binaryType = "nodebuffer"
  // The mux removes its error listener before closing. A late transport error must not escape to the host.
  ws.on("error", () => {})
  return {
    get readyState() {
      return ws.readyState
    },
    get bufferedAmount() {
      return ws.bufferedAmount
    },
    send(data, callback) {
      ws.send(data, { binary: true, compress: false }, (error) => callback?.(error ?? undefined))
    },
    ping() {
      if (ws.readyState === WebSocket.OPEN) ws.ping()
    },
    close(code, reason) {
      if (ws.readyState === WebSocket.OPEN) ws.close(code, reason)
    },
    terminate: () => ws.terminate(),
    onMessage(listener) {
      const receive = (raw: Buffer, binary: boolean) => listener(binary ? raw : raw.toString())
      ws.on("message", receive)
      ws.resume()
      return () => {
        ws.off("message", receive)
      }
    },
    onClose(listener) {
      const close = (code: number, reason: Buffer) => listener(code, reason.toString())
      ws.on("close", close)
      return () => {
        ws.off("close", close)
      }
    },
    onError(listener) {
      ws.on("error", listener)
      return () => {
        ws.off("error", listener)
      }
    },
    onPong(listener) {
      ws.on("pong", listener)
      return () => {
        ws.off("pong", listener)
      }
    },
  }
}

export class UpgradeError extends Error {
  constructor(
    message: string,
    readonly fallback: boolean,
  ) {
    super(message)
  }
}

export async function open(url: URL, headers: Record<string, string>, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<BrowserTunnelHost.BinarySocket>((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers,
      followRedirects: false,
      perMessageDeflate: false,
      maxPayload: StreamWire.MAX_WS_FRAME_BYTES,
      handshakeTimeout: 4_000,
      rejectUnauthorized: true,
    })
    const cleanup = () => {
      signal.removeEventListener("abort", cancel)
      ws.off("open", opened)
      ws.off("error", failed)
      ws.off("unexpected-response", rejected)
    }
    const fail = (error: unknown) => {
      cleanup()
      ws.on("error", () => {})
      ws.terminate()
      reject(error)
    }
    const cancel = () => fail(signal.reason)
    const opened = () => {
      cleanup()
      ws.pause()
      resolve(adapt(ws))
    }
    const rejected = (_request: unknown, response: { statusCode?: number }) => {
      const status = response.statusCode ?? 0
      const fallback = [200, 204, 400, 404, 405, 426, 501, 502, 503, 504].includes(status)
      fail(new UpgradeError(`Browser WebSocket upgrade returned HTTP ${status}.`, fallback))
    }
    const failed = (error: Error & { code?: string }) => {
      const transport = error.code
        ? ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ENETUNREACH", "EHOSTUNREACH"].includes(error.code)
        : error.message === "Opening handshake has timed out"
      fail(new UpgradeError(`Browser WebSocket upgrade failed: ${error.message}`, transport))
    }
    signal.addEventListener("abort", cancel, { once: true })
    ws.once("open", opened)
    ws.once("error", failed)
    ws.once("unexpected-response", rejected)
  })
}
