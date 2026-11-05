import { expect } from "bun:test"
import { Effect } from "effect"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("artifact API requires authentication, preserves revisions and isolates sessions", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
    yield* Effect.promise(() => mkdir(`${tmp.path}/report`))
    yield* Effect.promise(() => Bun.write(`${tmp.path}/report/index.html`, "<h1>First</h1>"))
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: `${tmp.path}/artifacts.sqlite` },
      config: { global: false, project: false },
      models: { fetch: false },
      fs: { filewatcher: false },
      password: "secret",
    })
    const headers = { authorization: `Basic ${btoa("opencode:secret")}`, "content-type": "application/json" }
    const request = (path: string, method = "GET", body?: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local/api${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        ),
      )
    expect(
      (yield* Effect.promise(() =>
        handler(new Request("http://opencode.local/api/session/ses_artifacts_api/artifact")),
      )).status,
    ).toBe(401)
    for (const id of ["ses_artifacts_api", "ses_artifacts_other"])
      expect((yield* request("/session", "POST", { id, location: { directory: tmp.path } })).status).toBe(200)
    const prefix = "/session/ses_artifacts_api/artifact"
    const created = yield* request(prefix, "POST", { source: "report", entry: "index.html", title: "Report" })
    expect(created.status).toBe(200)
    const result = (yield* Effect.promise(() => created.json())) as {
      data: { id: string; revisions: { id: string }[] }
    }
    const { id, revisions } = result.data
    const file = `${prefix}/${id}/${revisions[0].id}/content?file=index.html`
    const response = yield* request(file)
    expect(response.status).toBe(200)
    expect((yield* Effect.promise(() => response.json())) as unknown).toEqual({ data: btoa("<h1>First</h1>") })
    expect((yield* request(file.replace("ses_artifacts_api", "ses_artifacts_other"))).status).toBe(400)
    expect((yield* request(prefix, "POST", { source: "..", entry: "index.html", title: "Outside" })).status).toBe(400)
    expect(
      (yield* request(prefix, "POST", { source: "report", entry: "index.html", id, expectedRevision: "rev_stale" }))
        .status,
    ).toBe(409)
  }),
)
