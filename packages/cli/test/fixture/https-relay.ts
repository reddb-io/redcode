import { createServer, type Socket } from "node:net"
import { request } from "node:https"
import path from "node:path"
import type { ServerWebSocket } from "bun"

/** Private CA and protocol-compatible loopback relay: no public DNS, account or network exposure. */
export async function httpsRelay(root: string, name: string) {
  const directory = path.join(root, name)
  await Bun.write(path.join(directory, ".fixture"), "local HTTPS relay")
  const openssl =
    Bun.which("openssl") ?? (process.platform === "win32" ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl")
  const command = async (args: string[]) => {
    const child = Bun.spawn([openssl, ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" })
    const error = await new Response(child.stderr).text()
    if (await child.exited) throw new Error(error)
  }
  await command([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "2",
    "-subj",
    `/CN=Redcode test ${name} CA`,
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
  ])
  const ca = await Bun.file(path.join(directory, "ca.pem")).text()
  let certificate = ""
  let bridge: ServerWebSocket<undefined> | undefined
  let route = ""
  let next = 0
  const channels = new Map<number, Socket>()
  const attached: string[] = []
  const relay = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, server) {
      const pathname = new URL(request.url).pathname
      if (
        pathname.endsWith("/connect") &&
        server.upgrade(request, { headers: { "sec-websocket-protocol": "opentunnel" } })
      )
        return
      if (pathname === "/api/tunnel" && request.method === "POST")
        return Response.json(
          { tunnel: { id: name, hostname: `${name}.relay.test`, state: "offline" }, token: `fixture-token-${name}` },
          { status: 201 },
        )
      if (pathname.endsWith("/certificate")) {
        if (request.method === "POST") {
          const body = (await request.json()) as { csr: string }
          await Bun.write(path.join(directory, "request.csr"), body.csr)
          await command([
            "x509",
            "-req",
            "-in",
            "request.csr",
            "-CA",
            "ca.pem",
            "-CAkey",
            "ca.key",
            "-CAcreateserial",
            "-copy_extensions",
            "copy",
            "-days",
            "1",
            "-out",
            "certificate.pem",
          ])
          certificate = await Bun.file(path.join(directory, "certificate.pem")).text()
        }
        return Response.json(
          { id: `cert-${name}`, state: { type: "ready", certificate, chain: ca, expiry: "2099-01-01T00:00:00Z" } },
          { status: request.method === "POST" ? 202 : 200 },
        )
      }
      return new Response(null, { status: 404 })
    },
    websocket: {
      message(socket, message) {
        if (typeof message === "string") {
          const value = JSON.parse(message) as {
            type: string
            routes?: string[]
            token?: string
            conn: number
            time_sent?: number
          }
          if (value.type === "attach") {
            if (value.token !== `fixture-token-${name}`) return socket.close()
            bridge = socket
            route = value.routes![0]!
            attached.push(route)
            socket.send(
              JSON.stringify({
                type: "attached",
                session: name,
                routes: value.routes,
                heartbeat_ms: 15000,
                idle_timeout_ms: 45000,
              }),
            )
            return
          }
          if (value.type === "ping") {
            socket.send(JSON.stringify({ type: "pong", time_sent: value.time_sent }))
            return
          }
          if (value.type === "end") channels.get(value.conn)?.end()
          if (value.type === "reset") channels.get(value.conn)?.destroy()
          return
        }
        channels.get(message.readUInt32BE(0))?.write(message.subarray(4))
      },
      close(socket) {
        if (bridge === socket) bridge = undefined
      },
    },
  })
  const listener = createServer((socket) => {
    const current = bridge
    if (!current) return socket.destroy()
    const id = ++next
    channels.set(id, socket)
    current.send(
      JSON.stringify({
        type: "open",
        conn: id,
        peer: "127.0.0.1",
        sni: `${route}.${name}.relay.test`,
        alpn: "http/1.1",
      }),
    )
    socket.on("data", (data) => {
      const frame = Buffer.alloc(data.length + 4)
      frame.writeUInt32BE(id, 0)
      data.copy(frame, 4)
      current.send(frame)
    })
    socket.on("end", () => current.send(JSON.stringify({ type: "end", conn: id })))
    socket.on("close", () => channels.delete(id))
    socket.on("error", () => socket.destroy())
  })
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve))
  const address = listener.address()
  if (!address || typeof address === "string") throw new Error("Missing fixture listener")
  return {
    api: relay.url.origin,
    attached,
    disconnect: () => bridge?.close(1001, "Fixture reconnection"),
    get: (url: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const call = request(
          {
            host: "127.0.0.1",
            port: address.port,
            servername: new URL(url).hostname,
            ca,
            path: "/health",
            headers: { authorization: "Bearer fixture-host-secret" },
            agent: false,
          },
          (response) => {
            let body = ""
            response.on("data", (chunk) => {
              body += chunk
            })
            response.on("end", () => resolve({ status: response.statusCode!, body }))
          },
        )
        call.setTimeout(5000, () => call.destroy(new Error("Fixture HTTPS request timed out")))
        call.on("error", reject)
        call.end()
      }),
    close: async () => {
      channels.forEach((socket) => socket.destroy())
      await new Promise<void>((resolve) => listener.close(() => resolve()))
      await relay.stop(true)
    },
  }
}
