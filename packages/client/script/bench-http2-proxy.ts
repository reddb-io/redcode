import { isolatedBenchmark } from "./bench-isolation"
import { Effect } from "effect"
import http from "node:http"
import http2 from "node:http2"
import type { AddressInfo } from "node:net"
import { startServer } from "../../server/test/fixture/server"
import { tmpdir } from "../../core/test/fixture/tmpdir"

// Isolated HTTP/1.1 backend and loopback proxy. HTTP/2 is h2c (not browser TLS); the delay is synthetic.
using isolation = isolatedBenchmark
await using directory = await tmpdir("redcode-http2-bench-")
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* startServer(directory.path)
      const delayMs = 80
      const upstream = async () => {
        await Bun.sleep(delayMs)
        const response = await fetch(new URL("/api/info", server.base), { headers: server.headers })
        return { status: response.status, body: await response.arrayBuffer() }
      }
      const h1 = http.createServer((_request, response) => {
        void upstream()
          .then((result) => {
            response.writeHead(result.status)
            response.end(Buffer.from(result.body))
          })
          .catch(() => {
            response.writeHead(502)
            response.end()
          })
      })
      const h2 = http2.createServer()
      h2.on("stream", (stream) => {
        void upstream()
          .then((result) => {
            stream.respond({ ":status": result.status })
            stream.end(Buffer.from(result.body))
          })
          .catch(() => {
            stream.respond({ ":status": 502 })
            stream.end()
          })
      })
      yield* Effect.promise(() =>
        Promise.all([
          new Promise<void>((resolve) => h1.listen(0, "127.0.0.1", resolve)),
          new Promise<void>((resolve) => h2.listen(0, "127.0.0.1", resolve)),
        ]),
      )
      const h1URL = `http://127.0.0.1:${(h1.address() as AddressInfo).port}/api/info`
      const h2URL = `http://127.0.0.1:${(h2.address() as AddressInfo).port}`
      const agents = [4, 6, 12].map((maxSockets) => new http.Agent({ keepAlive: true, maxSockets }))
      const session = http2.connect(h2URL)
      const http1 = (agent: http.Agent) => () =>
        new Promise<void>((resolve, reject) => {
          const request = http.get(h1URL, { agent }, (response) => {
            if (response.statusCode !== 200) return reject(new Error(`HTTP/1 status ${response.statusCode}`))
            response.resume()
            response.on("end", resolve)
            response.on("error", reject)
          })
          request.on("error", reject)
        })
      const http2Request = () =>
        new Promise<void>((resolve, reject) => {
          const request = session.request({ ":path": "/api/info" })
          let status = 0
          request.on("response", (headers) => {
            status = Number(headers[":status"])
          })
          request.on("data", () => {})
          request.on("end", () => (status === 200 ? resolve() : reject(new Error(`HTTP/2 status ${status}`))))
          request.on("error", reject)
          request.end()
        })
      const batch = async (request: () => Promise<void>, concurrency: number) => {
        let next = 0
        await Promise.all(
          Array.from({ length: concurrency }, async () => {
            while (next < 12) {
              next++
              await request()
            }
          }),
        )
      }
      try {
        for (const [name, request, concurrency] of [
          ["http1-limit4", http1(agents[0]), 4],
          ["http1-limit6", http1(agents[1]), 6],
          ["http1-limit12", http1(agents[2]), 12],
          ["http2-limit4", http2Request, 4],
          ["http2-limit12", http2Request, 12],
        ] as const) {
          const samplesMs = []
          for (let sample = 0; sample < 6; sample++) {
            const start = performance.now()
            yield* Effect.promise(() => batch(request, concurrency))
            if (sample > 0) samplesMs.push(+(performance.now() - start).toFixed(2))
          }
          console.log(JSON.stringify({ scenario: "http2-proxy", name, delayMs, requests: 12, samplesMs }))
        }
      } finally {
        agents.forEach((agent) => agent.destroy())
        session.destroy()
        h1.close()
        h2.close()
      }
    }),
  ),
)
