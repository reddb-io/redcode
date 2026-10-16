import path from "node:path"
import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { WorkerLease } from "@opencode/schema/worker-lease"
import { WorkerLeaseTable } from "@opencode/core/worker-lease.sql"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live(
  "two worker runtimes fence competing coordinators and preserve CORS across expiry and recovery",
  () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      const database = path.join(temporary.path, "worker.db")
      const options = {
        database: { path: database },
        app: { version: "test" },
        password: "secret",
        cors: ["http://client.test"],
        config: { directory: temporary.path, global: false, project: false, content: '{"worktree":{"auto":false}}' },
        models: { fetch: false },
        fs: { filewatcher: false, fff: false },
      }
      const first = yield* ServerFetch.make({
        ...options,
        workers: { directory: path.join(temporary.path, "coordinator-one") },
      })
      const second = yield* ServerFetch.make({
        ...options,
        workers: { directory: path.join(temporary.path, "coordinator-two") },
      })
      const send = (handler: typeof first, route: string, body: unknown, fence?: WorkerLease.Info, method = "POST") =>
        handler(
          new Request(`http://worker.test/api/${route}`, {
            method,
            headers: {
              authorization: `Basic ${btoa("opencode:secret")}`,
              "content-type": "application/json",
              origin: "http://client.test",
              ...(fence
                ? {
                    "x-redcode-worker-fence": JSON.stringify({
                      owner: fence.owner,
                      holder: fence.holder,
                      generation: fence.generation,
                    }),
                  }
                : {}),
            },
            body: JSON.stringify(body),
          }),
        )
      const a = {
        directory: temporary.path,
        owner: "one",
        holder: "runtime-one",
        sessionID: "ses_lease_one",
        messageID: "msg_lease_one",
      }
      const b = {
        directory: path.join(temporary.path, ".") + path.sep,
        owner: "two",
        holder: "runtime-two",
        sessionID: "ses_lease_two",
        messageID: "msg_lease_two",
      }
      const acquired = yield* Effect.promise(async () =>
        Promise.all([
          send(first, "worker-lease/acquire", a)
            .then((response) => response.json())
            .then(Schema.decodeUnknownSync(WorkerLease.Result)),
          send(second, "worker-lease/acquire", b)
            .then((response) => response.json())
            .then(Schema.decodeUnknownSync(WorkerLease.Result)),
        ]),
      )
      expect(acquired.filter((result) => result.state === "busy")).toHaveLength(1)
      const owned = acquired.find((result) => result.state === "acquired")!
      if (owned.state !== "acquired") throw new Error("Expected one checkout owner")
      const lease = owned.lease
      const create = { id: lease.sessionID, location: { directory: temporary.path } }
      const unauthenticated = yield* Effect.promise(() =>
        first(
          new Request("http://worker.test/api/session", {
            method: "POST",
            headers: { "content-type": "application/json", origin: "http://client.test" },
            body: JSON.stringify(create),
          }),
        ),
      )
      expect(unauthenticated.status).toBe(401)
      expect((yield* Effect.promise(() => send(first, "session", create))).status).toBe(409)
      expect((yield* Effect.promise(() => send(first, "session", create, lease))).status).toBe(200)
      const prompt = { id: lease.messageID, text: "Must remain private and unexecuted", resume: false }
      const rejected = yield* Effect.promise(() => send(second, `session/${lease.sessionID}/prompt`, prompt))
      expect(rejected.status).toBe(409)
      expect(rejected.headers.get("access-control-allow-origin")).toBe("http://client.test")
      expect(
        (yield* Effect.promise(() => send(first, `session/${lease.sessionID}/prompt`, prompt, lease))).status,
      ).toBe(200)
      expect((yield* Effect.promise(() => send(first, "worker-lease/release", lease))).status).toBe(409)
      // Advance the persisted worker deadline, without replacing clocks or production services.
      yield* Effect.gen(function* () {
        const store = yield* Database.Service
        yield* store.db.update(WorkerLeaseTable).set({ expires_at: 1 }).run()
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(Database.node, [Database.node.replace(Database.configured({ path: database }))]),
        ),
      )
      expect((yield* Effect.promise(() => send(first, "worker-lease/renew", lease))).status).toBe(409)
      const busy = yield* Effect.promise(async () =>
        (await send(second, "worker-lease/acquire", { ...b, owner: "competitor", sessionID: "ses_competitor" })).json(),
      )
      expect(busy).toEqual({ state: "busy" })
      const recovered = yield* Effect.promise(async () =>
        Schema.decodeUnknownSync(WorkerLease.Result)(
          await (
            await send(second, "worker-lease/acquire", {
              directory: temporary.path,
              owner: lease.owner,
              sessionID: lease.sessionID,
              messageID: lease.messageID,
              holder: "replacement-runtime",
              recover: { owner: lease.owner, holder: lease.holder, generation: lease.generation },
            })
          ).json(),
        ),
      )
      if (recovered.state !== "acquired") throw new Error("Expected original task recovery")
      expect(recovered.lease.generation).toBe(lease.generation + 1)
      for (const action of [
        "prompt",
        "wake",
        "interrupt",
        "permission/req_unknown/reply",
        "form/form_unknown/reply",
        "move",
      ]) {
        const stale = yield* Effect.promise(() => send(first, `session/${lease.sessionID}/${action}`, prompt, lease))
        expect(stale.status).toBe(409)
        expect(stale.headers.get("access-control-allow-origin")).toBe("http://client.test")
      }
      const cancel = yield* Effect.promise(() =>
        send(second, `session/${lease.sessionID}/inbox/${lease.messageID}`, {}, recovered.lease, "DELETE"),
      )
      expect(cancel.status).toBe(204)
      expect((yield* Effect.promise(() => send(second, "worker-lease/release", recovered.lease))).status).toBe(204)
      expect((yield* Effect.promise(() => send(second, "worker-lease/release", recovered.lease))).status).toBe(204)
      expect(
        (yield* Effect.promise(() => send(first, `session/${lease.sessionID}/wake`, {}, recovered.lease))).status,
      ).toBe(409)
      const next = yield* Effect.promise(async () =>
        Schema.decodeUnknownSync(WorkerLease.Result)(
          await (
            await send(first, "worker-lease/acquire", { ...b, owner: "successor", sessionID: "ses_successor" })
          ).json(),
        ),
      )
      if (next.state !== "acquired") throw new Error("Expected next coordinator after confirmed release")
      expect(next.lease.generation).toBe(recovered.lease.generation + 1)
    }),
  30_000,
)
