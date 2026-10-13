export * as WorkerEnvironmentProxy from "./worker-environment-proxy"

/** Bundled into the approved image. The agent cannot modify this read-only gateway. */
export const script = String.raw`
const http = require("node:http")
const net = require("node:net")
const dns = require("node:dns/promises")

function publicAddress(address) {
  if (net.isIP(address) === 6) {
    const normalized = new URL("http://[" + address + "]").hostname.slice(1, -1)
    return /^[23][0-9a-f]{3}:/i.test(normalized) && !/^2001:(db8:|0:|:)/i.test(normalized) && !/^2002:/i.test(normalized)
  }
  if (net.isIP(address) !== 4) return false
  const [a, b, c] = address.split(".").map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99) ||
    a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113)
}

const egress = http.createServer((_request, response) => {
  response.writeHead(403); response.end("Use HTTPS CONNECT")
})
egress.on("connect", async (request, socket, head) => {
  const deny = () => { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n") }
  try {
    if (!request.url || !/^[a-zA-Z0-9.\[\]:_-]+:443$/.test(request.url)) return deny()
    const target = new URL("https://" + request.url)
    if (target.username || target.password || target.port && target.port !== "443") return deny()
    const hostname = target.hostname.replace(/^\[|\]$/g, "")
    const addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await dns.lookup(hostname, { all: true })
    if (!addresses.length || addresses.some((entry) => !publicAddress(entry.address))) return deny()
    const selected = addresses.find((entry) => entry.family === 4) || addresses[0]
    // Resolve once, validate every result and connect to the selected numeric address.
    const upstream = net.connect({ host: selected.address, port: 443, family: selected.family })
    upstream.setTimeout(300000, () => upstream.destroy())
    socket.setTimeout(300000, () => socket.destroy())
    upstream.on("error", () => socket.destroy())
    socket.on("error", () => upstream.destroy())
    socket.on("close", () => upstream.destroy())
    upstream.on("connect", () => {
      if (socket.destroyed) { upstream.destroy(); return }
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length) upstream.write(head)
      socket.pipe(upstream); upstream.pipe(socket)
    })
  } catch { deny() }
})
egress.maxConnections = 128
egress.listen(3128, "0.0.0.0")

const gateway = http.createServer((request, response) => {
  if (!request.url || !request.url.startsWith("/api/")) { response.writeHead(404); response.end(); return }
  const headers = { ...request.headers, host: "worker:4096" }
  delete headers["proxy-authorization"]
  const upstream = http.request({ hostname: "worker", port: 4096, path: request.url, method: request.method, headers, timeout: 45000 }, (incoming) => {
    response.writeHead(incoming.statusCode || 502, { "content-type": incoming.headers["content-type"] || "application/json" })
    incoming.pipe(response)
  })
  upstream.on("timeout", () => upstream.destroy())
  upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end() })
  response.on("close", () => upstream.destroy())
  request.pipe(upstream)
})
gateway.maxConnections = 128
gateway.listen(8080, "0.0.0.0")
`
