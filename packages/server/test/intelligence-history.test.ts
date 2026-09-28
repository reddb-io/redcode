import { expect } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("exposes bounded evaluation history only through authenticated requests", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      config: { project: false },
      models: { fetch: false },
      fs: { filewatcher: false },
      password: "secret",
    })
    const url = "http://opencode.local/api/experimental/intelligence/history?sessionID=ses_history&limit=1"
    const denied = yield* Effect.promise(() => handler(new Request(url)))
    expect(denied.status).toBe(401)
    const headers = { authorization: `Basic ${btoa("opencode:secret")}` }
    const response = yield* Effect.promise(() => handler(new Request(url, { headers })))
    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => response.json())).toEqual([])
    const invalid = yield* Effect.promise(() => handler(new Request(url.replace("limit=1", "limit=101"), { headers })))
    expect(invalid.status).toBe(400)
  }).pipe(Effect.scoped),
)
