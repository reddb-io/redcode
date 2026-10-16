import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ownerProcess } from "../../core/test/lib/owner-process"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { ServerFetch } from "../src/fetch"

it.live(
  "another process cannot execute or interrupt an owned session, and conflicts retain CORS",
  () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      const database = path.join(temporary.path, "sessions.db")
      const handler = yield* ServerFetch.make({
        app: { version: "test" },
        database: { path: database },
        config: { directory: temporary.path, project: false, global: false, content: "{}" },
        models: { fetch: false },
        fs: { filewatcher: false },
        password: "secret",
        cors: ["http://client.test"],
      })
      const headers = {
        authorization: `Basic ${btoa("opencode:secret")}`,
        "content-type": "application/json",
        origin: "http://client.test",
      }
      const sessionID = "ses_cross_process_owner"
      const created = yield* Effect.promise(() =>
        handler(
          new Request("http://redcode.local/api/session", {
            method: "POST",
            headers,
            body: JSON.stringify({ id: sessionID }),
          }),
        ),
      )
      expect(created.status).toBe(200)
      const observation = () =>
        Effect.promise(async () => {
          const response = await handler(
            new Request(`http://redcode.local/api/session/${sessionID}/observation?messageID=msg_original_task`, {
              headers,
            }),
          )
          expect(response.status).toBe(200)
          expect(response.headers.get("access-control-allow-origin")).toBe("http://client.test")
          const value: unknown = await response.json()
          expect(JSON.stringify(value)).not.toContain("private task content")
          return value
        })
      expect(yield* observation()).toMatchObject({
        data: {
          sessionID,
          messageID: "msg_original_task",
          admission: "missing",
          execution: "idle",
          pending: false,
          waiting: false,
        },
      })
      const admitted = yield* Effect.promise(() =>
        handler(
          new Request(`http://redcode.local/api/session/${sessionID}/prompt`, {
            method: "POST",
            headers,
            body: JSON.stringify({ id: "msg_original_task", text: "private task content", resume: false }),
          }),
        ),
      )
      expect(admitted.status).toBe(200)
      expect(yield* observation()).toMatchObject({ data: { admission: "pending", execution: "idle", pending: true } })
      const owner = yield* ownerProcess(database, sessionID)
      expect(yield* observation()).toMatchObject({
        data: { admission: "pending", execution: "running", waiting: null },
      })
      for (const [action, body] of [
        ["wake", {}],
        ["interrupt", {}],
        ["prompt", { text: "Do not execute" }],
        ["command", { name: "review", text: "" }],
        ["shell", { command: "exit 0" }],
        ["synthetic", { text: "Do not resume" }],
        ["compact", {}],
        ["move", { directory: temporary.path }],
        ["revert/stage", { messageID: "msg_not_applied" }],
        ["revert/commit", {}],
      ] as const) {
        const response = yield* Effect.promise(() =>
          handler(
            new Request(`http://redcode.local/api/session/${sessionID}/${action}`, {
              method: "POST",
              headers,
              body: JSON.stringify(body),
            }),
          ),
        )
        expect(response.status).toBe(409)
        expect(response.headers.get("access-control-allow-origin")).toBe("http://client.test")
        expect(yield* Effect.promise(() => response.json())).toMatchObject({ _tag: "SessionBusyError", sessionID })
      }
      const removed = yield* Effect.promise(() =>
        handler(
          new Request(`http://redcode.local/api/session/${sessionID}`, {
            method: "DELETE",
            headers,
          }),
        ),
      )
      expect(removed.status).toBe(409)
      expect(removed.headers.get("access-control-allow-origin")).toBe("http://client.test")
      yield* owner.stop
      expect(yield* observation()).toMatchObject({
        data: { admission: "pending", execution: "suspended", pending: true, waiting: false },
      })
      const response = yield* Effect.promise(() =>
        handler(
          new Request(`http://redcode.local/api/session/${sessionID}/interrupt`, {
            method: "POST",
            headers,
            body: "{}",
          }),
        ),
      )
      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toEqual({ interrupted: false })
    }).pipe(Effect.scoped),
  30_000,
)
