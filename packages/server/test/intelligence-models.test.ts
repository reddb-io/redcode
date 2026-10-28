import { expect } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("discovers models without a preset while requiring a model for a probe", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      config: { project: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const body = JSON.stringify({ evaluator: { transport: "openrouter", baseURL: "https://openrouter.ai/api/v1" } })
    const request = (path: string) =>
      handler(new Request(`http://opencode.local/api/experimental/intelligence/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }))
    const discovered = yield* Effect.promise(() => request("models"))
    expect(discovered.status).toBe(200)
    const catalog = yield* Effect.promise(() => discovered.json() as Promise<{ models: { id: string }[] }>)
    expect(catalog.models.map((model) => model.id)).toContain("typesafe/jev-1.14")
    const probe = yield* Effect.promise(() => request("probe"))
    expect(probe.status).toBe(400)
  }).pipe(Effect.scoped),
)
