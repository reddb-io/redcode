import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { createServer as createTcpServer, createConnection } from "node:net"
import { once } from "node:events"
import { BrowserTunnelHost } from "@opencode/plugin-browser/tunnel-host"
import { BrowserTunnelSocket } from "@opencode/plugin-browser/websocket"
import { StreamMux } from "@opencode/plugin-browser/stream-mux"
import { SessionID } from "@opencode/schema/session-id"
import { createBinaryTunnel } from "./binary-tunnel"

async function fixture() {
  const wss = BrowserTunnelSocket.makeServer()
  const http = createServer()
  const chunks: string[] = []
  const target = createTcpServer({ allowHalfOpen: true }, (socket) => {
    socket.on("data", (data) => {
      chunks.push(data.toString())
      socket.write(data)
    })
    socket.on("end", () => socket.end())
  })
  await once(target.listen(0, "127.0.0.1"), "listening")
  const address = target.address()
  if (!address || typeof address === "string") throw new Error("Target unavailable")
  await once(http.listen(0, "127.0.0.1"), "listening")
  const listener = http.address()
  if (!listener || typeof listener === "string") throw new Error("Server unavailable")
  const destination = { host: "127.0.0.1", port: address.port }
  let issued = 0
  let status = 101
  let now = 1
  const handshakes: { url?: string; ticket?: string | string[]; cookie?: string }[] = []
  http.on("upgrade", (req, socket, head) => {
    handshakes.push({ url: req.url, ticket: req.headers[BrowserTunnelHost.TICKET_HEADER], cookie: req.headers.cookie })
    if (status !== 101) {
      socket.end(`HTTP/1.1 ${status} Fixture\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      StreamMux.createServerMux(BrowserTunnelSocket.adapt(ws), {
        connect: (requested, signal) => {
          expect(requested).toEqual(destination)
          const socket = createConnection({ ...destination, allowHalfOpen: true, signal })
          return once(socket, "connect").then(() => socket)
        },
      }),
    )
  })
  const tunnel = createBinaryTunnel({
    server: { url: `http://127.0.0.1:${listener.port}/prefix/`, headers: { cookie: "not-forwarded" } },
    attachment: { sessionID: SessionID.make("ses_fixture"), connectionID: "attachment" },
    location: { directory: "C:/work/test", workspace: "wrk_test" },
    issue: () => Promise.resolve({ ticket: `ticket-${++issued}` }),
    now: () => now,
  })

  return {
    tunnel,
    destination,
    chunks,
    handshakes,
    setStatus: (code: number) => {
      status = code
    },
    advance: () => {
      now += 10_001
    },
    drop: () => wss.clients.forEach((socket) => socket.terminate()),
    async [Symbol.asyncDispose]() {
      tunnel.close()
      wss.clients.forEach((socket) => socket.terminate())
      await Promise.all([
        new Promise<void>((resolve) => wss.close(() => resolve())),
        new Promise<void>((resolve) => http.close(() => resolve())),
        new Promise<void>((resolve) => target.close(() => resolve())),
      ])
    },
  }
}

test("old servers use RPC without a ticket or a WebSocket attempt", async () => {
  await using f = await fixture()
  f.tunnel.negotiate(undefined)
  expect(await f.tunnel.open(f.destination, AbortSignal.timeout(1000))).toBeUndefined()
  expect(f.handshakes).toEqual([])
})

test("blocked upgrades fall back and negotiate again after a cooldown, while auth denial fails closed", async () => {
  await using f = await fixture()
  f.tunnel.negotiate([BrowserTunnelHost.STREAM_CAPABILITY])
  const open = () => f.tunnel.open(f.destination, AbortSignal.timeout(3000))
  f.setStatus(404)
  expect(await open()).toBeUndefined()
  expect(await open()).toBeUndefined()
  expect(f.handshakes).toHaveLength(1)
  f.advance()
  f.setStatus(403)
  await expect(open()).rejects.toMatchObject({ fallback: false })
  f.setStatus(101)
  const stream = await open()
  expect(stream).toBeDefined()
  stream?.destroy()
  expect(f.handshakes.map((call) => call.ticket)).toEqual(["ticket-1", "ticket-2", "ticket-3"])
  expect(
    f.handshakes.every((call) => !call.cookie && call.url?.startsWith("/prefix/api/experimental/browser/tunnel?")),
  ).toBe(true)
  expect(f.handshakes.every((call) => !call.url?.includes("ticket-"))).toBe(true)
})

test("disconnect fails an active stream and reconnects new streams with one fresh ticket", async () => {
  await using f = await fixture()
  f.tunnel.negotiate([BrowserTunnelHost.STREAM_CAPABILITY])
  const open = async () => {
    const stream = await f.tunnel.open(f.destination, AbortSignal.timeout(3000))
    if (!stream) throw new Error("Expected a binary stream")
    return stream
  }
  const interrupted = await open()
  const firstBytes = once(interrupted, "data")
  interrupted.write("before-drop")
  expect(String((await firstBytes)[0])).toBe("before-drop")
  const gone = once(interrupted, "error")
  f.drop()
  await gone
  const [next, concurrent] = await Promise.all([open(), open()])
  concurrent.destroy()
  const payload = Buffer.alloc(768 * 1024 + 17, 0x61)
  next.end(payload)
  const chunks: Buffer[] = []
  for await (const chunk of next) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks)).toEqual(payload)
  expect(f.chunks.join("")).toBe("before-drop" + payload.toString())
  expect(f.handshakes.map((call) => call.ticket)).toEqual(["ticket-1", "ticket-2"])
})
