import { expect } from "bun:test"
import { decode, encode } from "@reddb-io/toon"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const options = {
  app: { version: "test" },
  database: { path: ":memory:" },
  config: { project: false },
  models: { fetch: false },
  fs: { filewatcher: false },
  password: "secret",
} as const

it.live("serves legacy JSON and TOON RPC through the V2 Session service", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(options)
    const auth = { authorization: `Basic ${btoa("opencode:secret")}` }
    const request = (body: string, contentType: string) =>
      Effect.promise(() =>
        handler(
          new Request("http://opencode.local/rpc", {
            method: "POST",
            headers: { ...auth, "content-type": contentType },
            body,
          }),
        ),
      )

    const denied = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/rpc", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "health.get", params: {}, id: 1 }),
        }),
      ),
    )
    expect(denied.status).toBe(401)

    const health = yield* request(
      JSON.stringify({ jsonrpc: "2.0", method: "health.get", params: {}, id: 1 }),
      "application/json",
    )
    expect(health.status).toBe(200)
    expect(yield* Effect.promise(() => health.json())).toEqual({ jsonrpc: "2.0", result: { healthy: true }, id: 1 })

    const toon = yield* request(encode({ toonrpc: "1.0", method: "health.get", params: {}, id: 2 }), "application/toon")
    expect(toon.status).toBe(200)
    expect(decode(yield* Effect.promise(() => toon.text()))).toEqual({ toonrpc: "1.0", result: { healthy: true }, id: 2 })

    const rest = yield* Effect.promise(() =>
      handler(new Request("http://opencode.local/api/session", { headers: auth })),
    )
    const rpc = yield* request(
      JSON.stringify({ jsonrpc: "2.0", method: "session.list", params: {}, id: 3 }),
      "application/json",
    )
    expect(yield* Effect.promise(() => rpc.json())).toMatchObject({
      jsonrpc: "2.0",
      result: yield* Effect.promise(() => rest.json()),
      id: 3,
    })

    const active = yield* request(
      JSON.stringify({ jsonrpc: "2.0", method: "session.active", params: {}, id: 4 }),
      "application/json",
    )
    expect(yield* Effect.promise(() => active.json())).toEqual({ jsonrpc: "2.0", result: { data: {} }, id: 4 })
  }).pipe(Effect.scoped),
)
