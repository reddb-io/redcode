import { isolatedBenchmark } from "./bench-isolation"
import { Effect } from "effect"
import http from "node:http"
import { brotliDecompressSync, gunzipSync } from "node:zlib"
import { startServer } from "../../server/test/fixture/server"
import { tmpdir } from "../../core/test/fixture/tmpdir"

// Raw HTTP bytes from a temporary server; the OpenAPI JSON is a reproducible workload, not real user traffic.
using isolation = isolatedBenchmark
await using directory = await tmpdir("redcode-compression-bench-")
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* startServer(directory.path)
      const agent = new http.Agent({ keepAlive: true })
      try {
        for (const encoding of ["identity", "gzip", "br"]) {
          const samples = []
          for (let sample = 0; sample < 6; sample++) {
            const started = performance.now()
            const result = yield* Effect.promise(
              () =>
                new Promise<{ body: Buffer; encoding?: string; status?: number }>((resolve, reject) => {
                  const request = http.get(
                    new URL("/openapi.json", server.base),
                    { agent, headers: { ...server.headers, "accept-encoding": encoding } },
                    (response) => {
                      const chunks: Buffer[] = []
                      response.on("data", (chunk: Buffer) => chunks.push(chunk))
                      response.on("end", () =>
                        resolve({
                          body: Buffer.concat(chunks),
                          encoding: response.headers["content-encoding"],
                          status: response.statusCode,
                        }),
                      )
                      response.on("error", reject)
                    },
                  )
                  request.on("error", reject)
                }),
            )
            const elapsedMs = performance.now() - started
            if (result.status !== 200 || (result.encoding ?? "identity") !== encoding)
              throw new Error(`Unexpected response ${result.status} / ${result.encoding}`)
            const decoded =
              encoding === "gzip"
                ? gunzipSync(result.body)
                : encoding === "br"
                  ? brotliDecompressSync(result.body)
                  : result.body
            JSON.parse(decoded.toString("utf8"))
            if (sample > 0)
              samples.push({
                bytes: result.body.byteLength,
                decodedBytes: decoded.byteLength,
                elapsedMs: +elapsedMs.toFixed(2),
              })
          }
          console.log(JSON.stringify({ scenario: "openapi-compression", encoding, samples }))
        }
      } finally {
        agent.destroy()
      }
    }),
  ),
)
