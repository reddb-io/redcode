import { expect } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live(
  "Creator plugin API authenticates every lifecycle action and rejects invalid or out-of-project sources",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("creator-plugin-api-")))
      const handler = yield* ServerFetch.make({
        app: { version: "test-version" },
        database: { path: ":memory:" },
        config: { directory: path.join(directory.path, "config"), project: false, global: false },
        models: { fetch: false },
        fs: { filewatcher: false },
        password: "fixture-secret",
      })
      const base = "http://opencode.local/api/creator/plugin"
      const headers = {
        authorization: `Basic ${btoa("opencode:fixture-secret")}`,
        "x-opencode-directory": encodeURIComponent(directory.path),
        "content-type": "application/json",
      }
      const plugin = "/cplugin_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
      for (const [method, route, body] of [
        ["GET", "", undefined],
        ["GET", "/candidates", undefined],
        ["POST", "/review", {}],
        ["POST", "", {}],
        ["POST", `${plugin}/test`, { expectedVersion: 1 }],
        ["POST", `${plugin}/control`, { expectedVersion: 1, enabled: true }],
        ["DELETE", plugin, { expectedVersion: 1 }],
      ] as const) {
        expect(
          (yield* Effect.promise(() =>
            handler(
              new Request(base + route, {
                method,
                headers: { "content-type": "application/json" },
                ...(body ? { body: JSON.stringify(body) } : {}),
              }),
            ),
          )).status,
        ).toBe(401)
      }
      const listed = yield* Effect.promise(() => handler(new Request(base, { headers })))
      expect(listed.status).toBe(200)
      expect(yield* Effect.promise(() => listed.json())).toMatchObject({ data: [] })
      const missing = { sessionID: "ses_missing", designID: "design_missing", revision: "rev_missing" }
      for (const route of ["", "/review"]) {
        const result = yield* Effect.promise(() =>
          handler(new Request(base + route, { method: "POST", headers, body: JSON.stringify(missing) })),
        )
        expect(result.status).toBe(404)
        expect(yield* Effect.promise(() => result.json())).toMatchObject({ _tag: "CreatorPluginNotFoundError" })
      }
      const invalid = yield* Effect.promise(() =>
        handler(
          new Request(base + "/../../outside/control", {
            method: "POST",
            headers,
            body: JSON.stringify({ expectedVersion: 1, enabled: true }),
          }),
        ),
      )
      expect(invalid.status).not.toBe(200)
      const malformed = yield* Effect.promise(() =>
        handler(
          new Request(base + plugin + "/test", {
            method: "POST",
            headers,
            body: JSON.stringify({ expectedVersion: 0 }),
          }),
        ),
      )
      expect(malformed.status).toBe(400)
    }),
  60_000,
)
