import { expect } from "bun:test"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { it } from "../../core/test/lib/effect"
import { ServerPairing } from "../src/pairing"
import { ServerFetch } from "../src/fetch"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import type { RemoteAccess } from "@opencode/schema/remote-access"

it.live(
  "HTTPS management uses the authenticated host API and requires explicit exposure consent",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      let state: RemoteAccess.Status = { available: true, state: "disabled" }
      const operations: string[] = []
      const handler = yield* ServerFetch.make(
        {
          password: "host-secret",
          database: { path: ":memory:" },
          models: { fetch: false },
          config: { directory: tmp.path, project: false, global: false, content: "{}" },
          fs: { filewatcher: false, fff: false },
          cors: ["http://client.test"],
        },
        {
          remoteAccess: {
            status: () => state,
            configure: async (input) => {
              operations.push(input.relay)
              state = { available: true, state: "provisioning", relay: input.relay }
              return state
            },
            disable: async () => {
              operations.push("disable")
              state = { available: true, state: "disabled" }
              return state
            },
          },
        },
      )
      const request = (method = "GET", body?: unknown, authenticated = true) =>
        Effect.promise(() =>
          handler(
            new Request("http://host.test/api/remote-access", {
              method,
              headers: {
                "content-type": "application/json",
                origin: "http://client.test",
                ...(authenticated ? { authorization: `Basic ${btoa("opencode:host-secret")}` } : {}),
              },
              ...(body ? { body: JSON.stringify(body) } : {}),
            }),
          ),
        )
      expect((yield* request("GET", undefined, false)).status).toBe(401)
      expect(
        (yield* request("POST", { relay: "https://relay.example.test", acceptExposure: true }, false)).status,
      ).toBe(401)
      const snapshot = yield* request()
      expect(snapshot.status).toBe(200)
      expect(yield* Effect.promise(() => snapshot.json())).toEqual({ available: true, state: "disabled" })
      expect(operations).toEqual([])
      expect((yield* request("POST", { relay: "https://relay.example.test", acceptExposure: false })).status).toBe(400)
      expect((yield* request("POST", { relay: "https://relay.example.test" })).status).toBe(400)
      expect(operations).toEqual([])
      const accepted = yield* request("POST", { relay: "https://relay.example.test", acceptExposure: true })
      expect(accepted.status).toBe(200)
      expect(accepted.headers.get("access-control-allow-origin")).toBe("http://client.test")
      expect(yield* Effect.promise(() => accepted.json())).toMatchObject({ state: "provisioning" })
      expect((yield* request("DELETE")).status).toBe(200)
      expect(operations).toEqual(["https://relay.example.test", "disable"])
    }),
  30_000,
)

it.effect("pairing codes expire after five minutes and can be consumed only once", () =>
  Effect.gen(function* () {
    const pairing = yield* ServerPairing.Service
    const once = yield* pairing.issue()
    expect(yield* pairing.consume(once.code)).toBe(true)
    expect(yield* pairing.consume(once.code)).toBe(false)
    const expiring = yield* pairing.issue()
    expect(expiring.expires_in).toBe(300)
    yield* TestClock.adjust("5 minutes")
    expect(yield* pairing.consume(expiring.code)).toBe(false)
  }).pipe(Effect.provide(LayerNode.compile(ServerPairing.node))),
)
