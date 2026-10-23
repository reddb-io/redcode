import { expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { it, testEffect } from "../../core/test/lib/effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { TodoTable } from "@opencode/core/session/redcode.sql"
import { SessionTodo } from "@opencode/schema/session-todo"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { ServerFetch } from "../src/fetch"

it.live("reads tasks through the authenticated V2 session API and rejects missing sessions", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      config: { project: false },
      models: { fetch: false },
      fs: { filewatcher: false },
      password: "secret",
    })
    const headers = { authorization: `Basic ${btoa("opencode:secret")}`, "content-type": "application/json" }
    const url = "http://opencode.local/api/session/ses_tasks/todo"
    const denied = yield* Effect.promise(() => handler(new Request(url)))
    expect(denied.status).toBe(401)
    const missing = yield* Effect.promise(() => handler(new Request(url, { headers })))
    expect(missing.status).toBe(404)
    const created = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/session", {
          method: "POST",
          headers,
          body: JSON.stringify({ id: "ses_tasks" }),
        }),
      ),
    )
    expect(created.status).toBe(200)
    const response = yield* Effect.promise(() => handler(new Request(url, { headers })))
    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => response.json())).toEqual({ data: [] })
  }).pipe(Effect.scoped),
)

const reconciliationIt = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Global.node]), [Global.node.replace(tempGlobalLayer)]),
)

reconciliationIt.live(
  "collects scoped prerequisite results through the authenticated API without accepting tasks",
  () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const global = yield* Global.Service
      const handler = yield* ServerFetch.make(
        {
          app: { version: "test" },
          database: { path: ":memory:" },
          config: { project: false },
          models: { fetch: false },
          fs: { filewatcher: false },
          password: "secret",
        },
        {
          overrides: [
            Database.node.replace(Layer.succeed(Database.Service, database)),
            Global.node.replace(Layer.succeed(Global.Service, global)),
          ],
        },
      )
      const headers = { authorization: `Basic ${btoa("opencode:secret")}`, "content-type": "application/json" }
      for (const id of ["ses_reconciliation", "ses_other_reconciliation"]) {
        const created = yield* Effect.promise(() =>
          handler(
            new Request("http://opencode.local/api/session", { method: "POST", headers, body: JSON.stringify({ id }) }),
          ),
        )
        expect(created.status).toBe(200)
      }
      yield* database.db
        .insert(TodoTable)
        .values([
          {
            session_id: "ses_reconciliation",
            task_id: "todo_api",
            content: "Implement API",
            status: "pending",
            priority: "high",
            position: 0,
            revision: 2,
            details: { criterion: "API checks pass" },
          },
          {
            session_id: "ses_reconciliation",
            task_id: "todo_client",
            content: "Implement client",
            status: "blocked",
            priority: "high",
            position: 1,
            revision: 1,
            reason: "Waiting for endpoint",
            details: { criterion: "Client checks pass" },
          },
          {
            session_id: "ses_reconciliation",
            task_id: "todo_integrate",
            content: "Integrate delivery",
            status: "pending",
            priority: "high",
            position: 2,
            revision: 3,
            details: { dependencies: ["todo_api", "todo_client"], criterion: "Integration checks pass" },
          },
        ])
        .run()
      const url = "http://opencode.local/api/session/ses_reconciliation/todo/todo_integrate/reconciliation"
      expect((yield* Effect.promise(() => handler(new Request(url)))).status).toBe(401)
      const response = yield* Effect.promise(() => handler(new Request(`${url}?revision=3`, { headers })))
      expect(response.status).toBe(200)
      const report = Schema.decodeUnknownSync(Schema.Struct({ data: SessionTodo.Reconciliation }))(
        yield* Effect.promise(() => response.json()),
      ).data
      expect(report).toMatchObject({
        executionSettled: false,
        acceptanceReady: false,
        task: { id: "todo_integrate", revision: 3 },
      })
      expect(report.inputs.map((input) => input.acceptance)).toEqual(["pending", "blocked"])
      expect((yield* Effect.promise(() => handler(new Request(`${url}?revision=2`, { headers })))).status).toBe(400)
      expect(
        (yield* Effect.promise(() =>
          handler(new Request(url.replace("ses_reconciliation", "ses_other_reconciliation"), { headers })),
        )).status,
      ).toBe(400)
      expect(
        (yield* Effect.promise(() =>
          handler(new Request(url.replace("ses_reconciliation", "ses_missing_reconciliation"), { headers })),
        )).status,
      ).toBe(404)
      const persisted = yield* database.db
        .select({ status: TodoTable.status, revision: TodoTable.revision })
        .from(TodoTable)
        .all()
      expect(persisted).toEqual([
        { status: "pending", revision: 2 },
        { status: "blocked", revision: 1 },
        { status: "pending", revision: 3 },
      ])
    }).pipe(Effect.scoped),
)
