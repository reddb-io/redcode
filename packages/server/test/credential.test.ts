import { expect } from "bun:test"
import { Credential } from "@opencode/schema/credential"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("rotates a credential through HTTP without replacing its identity or changing label-only updates", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      config: { project: false, global: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const request = (path: string, method: string, body?: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(`http://redcode.local${path}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        ),
      )
    const created = yield* request("/api/credential", "POST", {
      integrationID: "rotation-test",
      label: "original",
      value: { type: "key", key: "old-test-key" },
    })
    expect(created.status).toBe(200)
    const credential = Schema.decodeUnknownSync(Schema.Struct({ data: Credential.Entry }))(
      yield* Effect.promise(() => created.json()),
    ).data
    for (const body of [{ value: { type: "key", key: "new-test-key" } }, { label: "renamed" }]) {
      expect((yield* request(`/api/credential/${credential.id}`, "PATCH", body)).status).toBe(204)
      const response = yield* request("/api/credential", "GET")
      const listed = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(Credential.Entry) }))(
        yield* Effect.promise(() => response.json()),
      ).data
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({
        id: credential.id,
        label: "label" in body ? "renamed" : "original",
        active: true,
        value: { type: "key", key: "new-test-key" },
      })
    }
  }),
)
