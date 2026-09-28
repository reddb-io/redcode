import { expect } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("reads tasks through the authenticated V2 session API and rejects missing sessions", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      config: { project: false },
      models: { fetch: false },
      fs: { filewatcher: false },
      password: "secret",
    })
    const headers = { authorization: `Basic ${btoa("opencode:secret")}`, "content-type": "application/json" }
    const url = "http://opencode.local/api/session/ses_tasks/todo"
    const denied = yield* Effect.promise(() => handler(new Request(url)))
    expect(denied.status).toBe(401)
    const missing = yield* Effect.promise(() => handler(new Request(url, { headers })))
    expect(missing.status).toBe(404)
    const created = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/session", {
          method: "POST",
          headers,
          body: JSON.stringify({ id: "ses_tasks" }),
        }),
      ),
    )
    expect(created.status).toBe(200)
    const response = yield* Effect.promise(() => handler(new Request(url, { headers })))
    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => response.json())).toEqual({ data: [] })
  }).pipe(Effect.scoped),
)
