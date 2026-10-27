import { expect } from "bun:test"
import { Automation } from "@opencode/schema/automation"
import { SessionExecution } from "@opencode/core/session/execution"
import { Effect, Schema } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("automation API preserves authentication, session ownership and explicit idempotent admission", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
    const handler = yield* ServerFetch.make(
      {
        app: { version: "test" },
        database: { path: `${tmp.path}/automations.sqlite` },
        config: { global: false, project: false },
        models: { fetch: false },
        fs: { filewatcher: false },
        password: "secret",
      },
      { overrides: [SessionExecution.node.replace(SessionExecution.noopLayer)] },
    )
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
    const prefix = "/session/ses_automation/automation"
    expect((yield* Effect.promise(() => handler(new Request(`http://opencode.local/api${prefix}`)))).status).toBe(401)
    expect((yield* request(prefix)).status).toBe(404)
    for (const id of ["ses_automation", "ses_other"])
      expect((yield* request("/session", "POST", { id, location: { directory: tmp.path } })).status).toBe(200)
    const input = {
      id: Automation.ID.create(),
      title: "Inspect build",
      prompt: "Check the build result",
      schedule: { type: "interval" as const, everyMs: 60000 },
    }
    expect((yield* request(prefix, "POST", { ...input, schedule: { type: "interval", everyMs: 10 } })).status).toBe(400)
    const calendar = { type: "fixed_time", timeOfDay: "09:00", timeZone: "America/Sao_Paulo", weekdays: [1, 3, 5] }
    expect(
      (yield* request(prefix, "POST", { ...input, schedule: { ...calendar, timeZone: "Not/AZone" } })).status,
    ).toBe(400)
    expect((yield* request(prefix, "POST", { ...input, schedule: { ...calendar, weekdays: [] } })).status).toBe(400)
    const calendarID = Automation.ID.create()
    const calendarResponse = yield* request(prefix, "POST", { ...input, id: calendarID, schedule: calendar })
    expect(calendarResponse.status).toBe(200)
    expect(yield* Effect.promise(() => calendarResponse.json())).toMatchObject({ data: { schedule: calendar } })
    expect((yield* request(`${prefix}/${calendarID}`, "DELETE")).status).toBe(204)
    const response = yield* request(prefix, "POST", input)
    expect(response.status).toBe(200)
    const task = yield* Effect.promise(() => response.json()).pipe(
      Effect.map(Schema.decodeUnknownSync(Schema.Struct({ data: Automation.Info }))),
    )
    expect(task.data.sessionID).toBe("ses_automation")
    expect(task.data.enabled).toBe(true)
    const repeated = yield* request(prefix, "POST", { ...input, title: "Ignored retry" })
    expect(yield* Effect.promise(() => repeated.json())).toEqual(task)
    const other = `/session/ses_other/automation/${input.id}`
    expect((yield* request(`${other}/history`)).status).toBe(404)
    expect((yield* request(`${other}/control`, "POST", { enabled: false })).status).toBe(404)
    expect((yield* request(other, "DELETE")).status).toBe(404)
    expect((yield* request(`${prefix}/${input.id}/control`, "POST", { enabled: false })).status).toBe(200)
    const runID = Automation.RunID.create()
    const first = yield* request(`${prefix}/${input.id}/run`, "POST", { id: runID })
    expect(first.status).toBe(200)
    const run = yield* Effect.promise(() => first.json()).pipe(
      Effect.map(Schema.decodeUnknownSync(Schema.Struct({ data: Automation.Run }))),
    )
    expect(run.data.status).toBe("admitted")
    const second = yield* request(`${prefix}/${input.id}/run`, "POST", { id: runID })
    expect(yield* Effect.promise(() => second.json())).toEqual(run)
    const history = yield* request(`${prefix}/${input.id}/history`)
    expect(yield* Effect.promise(() => history.json())).toEqual({ data: [run.data] })
    const inbox = yield* request("/session/ses_automation/inbox")
    expect(yield* Effect.promise(() => inbox.json())).toMatchObject({
      data: [{ id: run.data.inboxID, delivery: "queue" }],
    })
    expect((yield* request(`${prefix}/${input.id}`, "DELETE")).status).toBe(204)
    expect((yield* request(`${prefix}/${input.id}/history`)).status).toBe(404)
    const empty = yield* request(prefix)
    expect(yield* Effect.promise(() => empty.json())).toEqual({ data: [] })
  }),
)
