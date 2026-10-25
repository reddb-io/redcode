import { expect } from "bun:test"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })

it.live("updates session metadata through PATCH", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      config: { global: false, project: false },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const request = (path: string, method: string, body?: unknown) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${path}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
        expect(response.status).toBe(method === "PATCH" ? 204 : 200)
        return response.status === 204 ? undefined : response.json()
      })

    const created = Schema.decodeUnknownSync(SessionResponse)(
      yield* request("/api/session", "POST", { metadata: { source: "create", stale: true } }),
    )
    yield* request(`/api/session/${created.data.id}`, "PATCH", { metadata: { source: "patch" } })
    const updated = Schema.decodeUnknownSync(SessionResponse)(yield* request(`/api/session/${created.data.id}`, "GET"))

    expect(updated.data.metadata).toEqual({ source: "patch" })
  }).pipe(Effect.scoped),
)

it.live("archives through HTTP, preserves history and restores without starting work", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      config: { global: false, project: false },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const request = (path: string, method = "GET", body?: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local${path}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        ),
      )
    const response = yield* request("/api/session", "POST", { title: "Keep me" })
    const created = Schema.decodeUnknownSync(SessionResponse)(yield* Effect.promise(() => response.json()))
    const id = created.data.id
    const archive = yield* request(`/api/session/${id}/archive`, "POST", { archived: true })
    expect(archive.status).toBe(204)
    expect((yield* request(`/api/session/${id}/archive`, "POST", { archived: true })).status).toBe(204)
    const list = yield* Effect.promise(async () =>
      (await handler(new Request("http://opencode.local/api/session?archived=only"))).json(),
    )
    expect(list.data.map((item: { id: string }) => item.id)).toContain(id)
    const prompt = yield* request(`/api/session/${id}/prompt`, "POST", { text: "must not execute", resume: false })
    expect(prompt.status).toBe(409)
    const restored = yield* request(`/api/session/${id}/archive`, "POST", { archived: false })
    expect(restored.status).toBe(204)
    const read = yield* request(`/api/session/${id}`)
    const current = Schema.decodeUnknownSync(SessionResponse)(yield* Effect.promise(() => read.json()))
    expect(current.data.title).toBe("Keep me")
    expect(current.data.time.archived).toBeUndefined()
    expect(current.data.time.updated).toBe(created.data.time.updated)
    expect((yield* request("/api/session/ses_missing/archive", "POST", { archived: true })).status).toBe(404)
  }).pipe(Effect.scoped),
)
