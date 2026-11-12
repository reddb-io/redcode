import { expect } from "bun:test"
import path from "node:path"
import { Effect, Schema } from "effect"
import { CreatorComponent } from "@opencode/schema/creator-component"
import { Design } from "@opencode/schema/design"
import { Session } from "@opencode/schema/session"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live(
  "Creator component API requires authentication, validates writes and reports missing project sources",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("creator-components-api-")))
      const handler = yield* ServerFetch.make({
        app: { version: "test-version" },
        database: { path: ":memory:" },
        config: { directory: path.join(directory.path, "config"), project: false, global: false },
        models: { fetch: false },
        fs: { filewatcher: false },
        password: "fixture-secret",
      })
      const base = "http://opencode.local/api/creator/component"
      const headers = {
        authorization: `Basic ${btoa("opencode:fixture-secret")}`,
        "x-opencode-directory": encodeURIComponent(directory.path),
        "content-type": "application/json",
      }
      expect((yield* Effect.promise(() => handler(new Request(base)))).status).toBe(401)
      const list = yield* Effect.promise(() => handler(new Request(base, { headers })))
      expect(list.status).toBe(200)
      expect(yield* Effect.promise(() => list.json())).toMatchObject({ data: [] })
      const source = {
        sessionID: Session.ID.make("ses_missing"),
        designID: Design.ID.make("design_missing"),
        revision: "rev_missing",
        name: "Widget",
      }
      const installed = yield* Effect.promise(() =>
        handler(new Request(base, { method: "POST", headers, body: JSON.stringify(source) })),
      )
      expect(installed.status).toBe(404)
      expect(yield* Effect.promise(() => installed.json())).toMatchObject({
        _tag: "CreatorComponentNotFoundError",
        message: "Creator component source is not in this project location",
      })
      const id = CreatorComponent.ID.create()
      const malformed = yield* Effect.promise(() =>
        handler(
          new Request(`${base}/${id}/control`, {
            method: "POST",
            headers,
            body: JSON.stringify({ expectedVersion: 0, enabled: true }),
          }),
        ),
      )
      expect(malformed.status).toBe(400)
      const missing = yield* Effect.promise(() => handler(new Request(`${base}/${id}/preview`, { headers })))
      expect(missing.status).toBe(404)
      const final = yield* Effect.promise(() => handler(new Request(base, { headers })))
      const inventory = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(CreatorComponent.Info) }))(
        yield* Effect.promise(() => final.json()),
      )
      expect(inventory.data).toEqual([])
    }),
  60_000,
)
