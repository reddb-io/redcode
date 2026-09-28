import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { Effect } from "effect"
import { Monitor } from "@opencode/schema/monitor"
import { SessionID } from "@opencode/schema/session-id"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("monitor API preserves authentication, session isolation and bounded evidence", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
    const path = `${tmp.path}/monitors.sqlite`
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path },
      config: { project: false },
      models: { fetch: false },
      fs: { filewatcher: false },
      password: "secret",
    })
    const headers = { authorization: `Basic ${btoa("opencode:secret")}`, "content-type": "application/json" }
    const request = (path: string, body?: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local/api/session${path}`, {
            method: body === undefined ? "GET" : "POST",
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        ),
      )
    expect(
      (yield* Effect.promise(() => handler(new Request("http://opencode.local/api/session/ses_monitor/monitor"))))
        .status,
    ).toBe(401)
    expect((yield* request("/ses_monitor/monitor")).status).toBe(404)
    for (const id of ["ses_monitor", "ses_other"]) expect((yield* request("", { id })).status).toBe(200)
    const empty = yield* request("/ses_monitor/monitor")
    expect(yield* Effect.promise(() => empty.json())).toEqual({ data: [] })
    const info: Monitor.Info = {
      id: "monitor_test",
      sessionID: SessionID.make("ses_monitor"),
      command: "probe: GET https://example.com",
      workdir: tmp.path,
      options: { mode: "once" },
      probe: { type: "http", url: "https://example.com", headers: { authorization: "private-token" } },
      status: "succeeded",
      created: 1,
      updated: 2,
      attempts: 1,
      delivery: "observed",
      evidence: { exit: 0, output: "x".repeat(50_000), truncated: false },
    }
    const db = yield* Effect.acquireRelease(
      Effect.sync(() => new Database(path)),
      (db) => Effect.sync(() => db.close()),
    )
    db.query("INSERT INTO session_monitor (id, session_id, owner, data) VALUES (?, ?, ?, ?)").run(
      info.id,
      info.sessionID,
      "fixture",
      JSON.stringify(info),
    )
    const listed = yield* request("/ses_monitor/monitor")
    expect(listed.status).toBe(200)
    expect(yield* Effect.promise(() => listed.json())).toEqual({ data: [Monitor.bounded(info)] })
    const read = yield* request("/ses_monitor/monitor/monitor_test")
    expect(read.status).toBe(200)
    expect(yield* Effect.promise(() => read.json())).toEqual({ data: Monitor.bounded(info) })
    expect((yield* request("/ses_other/monitor/monitor_test")).status).toBe(404)
    expect((yield* request("/ses_other/monitor/monitor_test/cancel", {})).status).toBe(404)
    const cancelled = yield* request("/ses_monitor/monitor/monitor_test/cancel", {})
    expect(cancelled.status).toBe(200)
    expect(yield* Effect.promise(() => cancelled.json())).toEqual({ data: Monitor.bounded(info) })
  }).pipe(Effect.scoped),
)
