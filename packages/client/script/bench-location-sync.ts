import { isolatedBenchmark } from "./bench-isolation"
import { Effect } from "effect"
import { createRoot } from "solid-js"
import { OpenCode } from "@opencode/client/promise"
import { createData } from "@opencode/client/solid"
import { createRequestQueue } from "../../app/src/runtime/server/request-queue"
import { startServer } from "../../server/test/fixture/server"
import { tmpdir } from "../../core/test/fixture/tmpdir"

// Isolated in-memory server; the injected delay approximates RTT and is not a real WAN measurement.
using isolation = isolatedBenchmark
await using directory = await tmpdir("redcode-transport-bench-")
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* startServer(directory.path)
      for (const delayMs of [0, 80]) {
        const times: number[] = []
        const counts: number[] = []
        const modelMs: number[] = []
        for (let sample = 0; sample < 6; sample++) {
          let requests = 0
          let modelReady = 0
          let start = 0
          const fetchWithDelay: typeof fetch = Object.assign(
            async (input: RequestInfo | URL, init?: RequestInit) => {
              requests++
              if (delayMs) await Bun.sleep(delayMs)
              const result = await fetch(input, init)
              const url = new URL(input instanceof Request ? input.url : String(input))
              if (url.pathname === "/api/model" || url.pathname === "/api/location/bootstrap")
                modelReady = performance.now() - start
              return result
            },
            { preconnect: () => {} },
          )
          const queue = createRequestQueue({ fetch: fetchWithDelay })
          const api = OpenCode.make({ baseUrl: server.base, headers: server.headers, fetch: queue.fetch })
          const current = createRoot((dispose) => ({
            dispose,
            data: createData({
              api: () => api,
              directory: directory.path,
              event: { on: () => () => {}, listen: () => () => {} },
            }),
          }))
          start = performance.now()
          yield* Effect.promise(() => current.data.location.sync({ directory: directory.path }))
          const elapsed = performance.now() - start
          current.dispose()
          if (sample > 0) {
            times.push(elapsed)
            counts.push(requests)
            modelMs.push(modelReady)
          }
        }
        console.log(
          JSON.stringify({
            scenario: "location-sync",
            delayMs,
            samplesMs: times.map((v) => +v.toFixed(2)),
            requests: counts,
            modelHeadersMs: modelMs.map((v) => +v.toFixed(2)),
          }),
        )
      }
    }),
  ),
)
