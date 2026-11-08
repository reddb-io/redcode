import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { ModelPerformance } from "@opencode/schema/model-performance"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"
import { summarizeModelPerformance } from "../src/model-performance"

it.effect("aggregates persisted latency and generation rate by provider and model", () =>
  Effect.sync(() => {
    const snapshot = summarizeModelPerformance(
      [
        {
          id: "msg_performance",
          data: {
            agent: "build",
            model: { providerID: "openai", id: "gpt-test" },
            content: [{ type: "text", text: "done" }],
            tokens: { input: 20, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1_000, first: 1_300, streamed: 2_300, completed: 2_400 },
          },
        },
        { id: "invalid", data: { nope: true } },
      ],
      10_000,
    )

    expect(snapshot).toMatchObject({
      sampledAt: 10_000,
      requests: 1,
      errors: 0,
      latencyP50: 300,
      latencyP95: 300,
      throughputP50: 100,
      providers: [{ providerID: "openai", requests: 1, latencyP50: 300, throughputP50: 100 }],
      models: [{ model: { providerID: "openai", id: "gpt-test" }, requests: 1, throughputP50: 100 }],
    })
  }),
)

it.live("returns a bounded empty model-performance snapshot without starting project runtimes", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "performance-test" },
      database: { path: ":memory:" },
      config: { project: false, global: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const response = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/performance")))
    expect(response.status).toBe(200)
    const snapshot = Schema.decodeUnknownSync(ModelPerformance.Snapshot)(yield* Effect.promise(() => response.json()))
    expect(snapshot.requests).toBe(0)
    expect(snapshot.errors).toBe(0)
    expect(snapshot.providers).toEqual([])
    expect(snapshot.models).toEqual([])
    expect(snapshot.sampledAt - snapshot.from).toBe(24 * 60 * 60 * 1000)
  }).pipe(Effect.scoped),
)
