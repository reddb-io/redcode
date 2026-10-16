import { expect } from "bun:test"
import { OpenCode } from "@opencode/client/promise"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Context, Effect, Layer, RcMap, Schema } from "effect"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Form } from "@opencode/core/form"
import { Permission } from "@opencode/core/permission"
import { Attention } from "@opencode/schema/attention"
import { HostResources } from "@opencode/schema/host-resources"
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http"
import { llmClient } from "@opencode/core/effect/app-node-platform"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { LanguageModel, LLMClient } from "../../ai/src"
import { OpenAIChat } from "../../ai/src/protocols/openai-chat"
import { TestLLM } from "../../ai/src/testing"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { WorkerPool } from "../../cli/src/workers/pool"
import { ServerProcess } from "../src/process"
import { createRoutes } from "../src/routes"

const startServer = Effect.fnUntraced(function* (directory: string) {
  const server = yield* ServerProcess.start<never, never>({
    hostname: "127.0.0.1",
    port: 0,
    password: "secret",
    app: { version: "test" },
    workers: { directory: `${directory}/coordinator` },
    database: { path: ":memory:" },
    config: { directory, global: false, project: false, content: "{}" },
    models: { fetch: false },
    fs: { filewatcher: false, fff: false },
  })
  return {
    base: HttpServer.formatAddress(server.address),
    headers: { authorization: `Basic ${btoa("opencode:secret")}` },
  }
})

it.live(
  "native worker controls retain durable queue/steer identities and interrupt only the assigned harness",
  () =>
    Effect.gen(function* () {
      const checkout = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
      const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
      const llm = yield* TestLLM.Test.pipe(Effect.provide(TestLLM.testLayer()))
      yield* llm.always(TestLLM.hangAfter())
      const model = SessionRunnerModel.resolved(
        LanguageModel.make({ id: "worker-model", provider: "test", route: OpenAIChat.route }),
        {
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          cost: [],
          limit: { context: 200_000, output: 8_192 },
        },
      )
      const context = yield* Layer.build(
        createRoutes(
          {
            password: "secret",
            database: { path: ":memory:" },
            workers: { directory: `${checkout.path}/coordinator` },
            config: { directory: checkout.path, global: false, project: false, content: '{"worktree":{"auto":false}}' },
            models: { fetch: false },
            fs: { filewatcher: false, fff: false },
          },
          () => [],
          [
            llmClient.replace(Layer.succeed(LLMClient.Service, llm)),
            SessionRunnerModel.node.replace(
              Layer.succeed(SessionRunnerModel.Service, { resolve: () => Effect.succeed(model) }),
            ),
          ],
        ).pipe(Layer.provide(HttpServer.layerServices)),
      )
      const handler = Context.get(context, HttpRouter.HttpRouter)
        .asHttpEffect()
        .pipe(HttpEffect.toWebHandlerWith(context))
      const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
      const api = OpenCode.make({
        baseUrl: server.url.origin,
        headers: { authorization: `Basic ${btoa("opencode:secret")}` },
      })
      const sessionID = Session.ID.create()
      const messageID = SessionMessage.ID.create()
      const acquired = yield* Effect.promise(() =>
        api.workerLease.acquire({
          owner: "controls",
          holder: "controls-runtime",
          sessionID,
          messageID,
          directory: checkout.path,
        }),
      )
      if (acquired.state !== "acquired") throw new Error("Expected worker reservation")
      const fenced = {
        headers: {
          "x-redcode-worker-fence": JSON.stringify({
            owner: acquired.lease.owner,
            holder: acquired.lease.holder,
            generation: acquired.lease.generation,
          }),
        },
      }
      const session = yield* Effect.promise(() =>
        api.session.create({ id: sessionID, location: { directory: checkout.path } }, fenced),
      )
      yield* Effect.promise(() =>
        api.session.prompt({ sessionID: session.id, id: messageID, text: "Start assigned work" }, fenced),
      )
      yield* llm.wait(1)
      const input = {
        config: `${directory.path}/workers.json`,
        manifest: `${directory.path}/tasks.json`,
        report: `${directory.path}/report.json`,
        environment: { WORKER_PASSWORD: "secret" },
        coordinator: "controls-runtime",
      }
      yield* Effect.promise(async () => {
        await WorkerPool.add(input.config, {
          id: "first",
          url: server.url.origin,
          passwordEnv: "WORKER_PASSWORD",
          directories: [session.location.directory],
          tags: [],
        })
        await Bun.write(input.manifest, JSON.stringify({ tasks: [{ id: "assigned", prompt: "Start" }] }))
        await Bun.write(
          input.report,
          JSON.stringify({
            fingerprint: "fixture",
            tasks: [
              {
                id: "assigned",
                state: "running",
                worker: "first",
                url: server.url.origin,
                directory: session.location.directory,
                sessionID: session.id,
                messageID,
                leaseOwner: acquired.lease.owner,
                lease: acquired.lease,
              },
            ],
          }),
        )
      })
      const queueID = SessionMessage.ID.create()
      const steerID = SessionMessage.ID.create()
      yield* Effect.promise(async () => {
        await WorkerPool.control(input, {
          kind: "prompt",
          task: "assigned",
          id: queueID,
          text: "Later",
          delivery: "queue",
        })
        await WorkerPool.control(input, {
          kind: "prompt",
          task: "assigned",
          id: queueID,
          text: "Ignored duplicate",
          delivery: "steer",
        })
        await WorkerPool.control(input, {
          kind: "prompt",
          task: "assigned",
          id: steerID,
          text: "Change direction",
          delivery: "steer",
        })
        await expect(WorkerPool.control(input, { kind: "interrupt", task: "unrelated" })).rejects.toThrow(
          "no live assigned",
        )
      })
      const pending = yield* Effect.promise(() => api.session.inbox.list({ sessionID: session.id }))
      expect(
        pending.map((item) => ({
          id: item.id,
          delivery: item.delivery,
          text: item.type === "user" ? item.payload.text : undefined,
        })),
      ).toEqual([
        { id: queueID, delivery: "queue", text: "Later" },
        { id: steerID, delivery: "steer", text: "Change direction" },
      ])
      yield* Effect.promise(() => WorkerPool.control(input, { kind: "interrupt", task: "assigned" }))
      expect((yield* Effect.promise(() => api.session.get({ sessionID: session.id }))).outcome).toBe("interrupted")
      yield* Effect.promise(async () => {
        await expect(
          WorkerPool.control(input, {
            kind: "prompt",
            task: "assigned",
            id: SessionMessage.ID.create(),
            text: "Must not restart",
            delivery: "steer",
          }),
        ).rejects.toThrow("already completed")
      })
    }),
  20_000,
)

it.live(
  "the coordinator answers only pending requests belonging to the recorded worker assignment",
  () =>
    Effect.gen(function* () {
      const checkout = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
      const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
      const context = yield* Layer.build(
        createRoutes(
          {
            password: "secret",
            database: { path: ":memory:" },
            workers: { directory: `${checkout.path}/coordinator` },
            config: { directory: checkout.path, global: false, project: false, content: "{}" },
            models: { fetch: false },
            fs: { filewatcher: false, fff: false },
          },
          () => [],
        ).pipe(Layer.provide(HttpServer.layerServices)),
      )
      const handler = Context.get(context, HttpRouter.HttpRouter)
        .asHttpEffect()
        .pipe(HttpEffect.toWebHandlerWith(context))
      const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
      const headers = { authorization: `Basic ${btoa("opencode:secret")}` }
      const api = OpenCode.make({ baseUrl: server.url.origin, headers })
      const locations = Context.get(context, LocationServiceMap.Service)
      const beforeLocations = Array.from(yield* RcMap.keys(locations.rcMap))
      const empty = yield* Effect.promise(() => api.server.attention())
      expect(empty).toEqual({ data: [], unavailable: [] })
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual(beforeLocations)
      const one = yield* Effect.promise(() =>
        api.session.create({ title: "Assigned", location: { directory: checkout.path } }),
      )
      const other = yield* Effect.promise(() =>
        api.session.create({ title: "Unrelated", location: { directory: checkout.path } }),
      )
      const placement = yield* locations.contextEffect(Schema.decodeUnknownSync(Session.Info)(one).location)
      const forms = Context.get(placement, Form.Service)
      const permissions = Context.get(placement, Permission.Service)
      const permission = yield* permissions.ask({
        sessionID: Session.ID.make(one.id),
        action: "edit",
        resources: ["assigned.txt"],
        force: true,
      })
      const own = yield* forms.create({
        sessionID: one.id,
        title: "Assigned question",
        metadata: { kind: "question" },
        fields: [{ key: "choice", type: "string", title: "Choice", required: true }],
      })
      const unrelated = yield* forms.create({
        sessionID: other.id,
        title: "Other question",
        metadata: { kind: "question" },
        fields: [{ key: "choice", type: "string", title: "Choice", required: true }],
      })
      const secret = yield* forms.create({
        sessionID: one.id,
        title: "Credentials",
        metadata: { kind: "vault" },
        fields: [{ key: "secret", type: "string" }],
      })
      const config = `${directory.path}/workers.json`
      const manifest = `${directory.path}/tasks.json`
      const report = `${directory.path}/report.json`
      const input = {
        config,
        manifest,
        report,
        environment: { WORKER_PASSWORD: "secret" },
        coordinator: "answers-runtime",
      }
      const task = {
        id: "assigned",
        state: "waiting" as const,
        worker: "first",
        url: server.url.origin,
        sessionID: one.id,
        directory: one.location.directory,
      }
      const acquired = yield* Effect.promise(() =>
        api.workerLease.acquire({
          owner: "answers",
          holder: "answers-runtime",
          sessionID: one.id,
          messageID: SessionMessage.ID.create(),
          directory: one.location.directory,
        }),
      )
      if (acquired.state !== "acquired") throw new Error("Expected worker reservation")
      Object.assign(task, {
        lease: acquired.lease,
        leaseOwner: acquired.lease.owner,
        messageID: acquired.lease.messageID,
      })
      yield* Effect.promise(async () => {
        await WorkerPool.add(config, {
          id: "first",
          url: server.url.origin,
          passwordEnv: "WORKER_PASSWORD",
          directories: [one.location.directory],
          tags: [],
        })
        await Bun.write(manifest, JSON.stringify({ tasks: [{ id: "assigned", prompt: "Test" }] }))
        await Bun.write(report, JSON.stringify({ fingerprint: "fixture", tasks: [task] }))
      })
      const all = Schema.decodeUnknownSync(Attention.Snapshot)(yield* Effect.promise(() => api.server.attention()))
      expect(all.data.map((entry) => entry.session.id).sort()).toEqual([one.id, other.id].sort())
      const inbox = yield* Effect.promise(() => WorkerPool.attention(input))
      expect(inbox.unavailable).toEqual([])
      expect(inbox.data.map((entry) => entry.attention.session.id)).toEqual([one.id])
      expect(inbox.data[0]!.attention.permissions.map((request) => request.id)).toEqual([permission.id])
      expect(inbox.data[0]!.attention.forms.map((form) => form.id).sort()).toEqual([own.id, secret.id].sort())
      yield* Effect.promise(async () => {
        await expect(
          WorkerPool.answer(input, {
            kind: "question",
            task: "assigned",
            formID: unrelated.id,
            answer: { choice: "wrong" },
          }),
        ).rejects.toThrow("no longer waiting")
        await expect(
          WorkerPool.answer(input, {
            kind: "question",
            task: "assigned",
            formID: secret.id,
            answer: { secret: "forbidden" },
          }),
        ).rejects.toThrow("no longer waiting")
        await expect(WorkerPool.answer(input, { kind: "cancel", task: "unknown", formID: own.id })).rejects.toThrow(
          "no live assigned",
        )
        await WorkerPool.answer(input, {
          kind: "permission",
          task: "assigned",
          requestID: permission.id,
          decision: "once",
        })
        await WorkerPool.answer(input, {
          kind: "question",
          task: "assigned",
          formID: own.id,
          answer: { choice: "correct" },
        })
        await expect(
          WorkerPool.answer(input, {
            kind: "question",
            task: "assigned",
            formID: own.id,
            answer: { choice: "repeat" },
          }),
        ).rejects.toThrow("no longer waiting")
      })
      expect(yield* forms.state(own.id)).toMatchObject({ status: "answered", answer: { choice: "correct" } })
      expect(yield* forms.state(unrelated.id)).toEqual({ status: "pending" })
      const registration = (yield* Effect.promise(() => WorkerPool.readConfig(config))).workers[0]!
      const resources = Schema.decodeUnknownSync(HostResources.Snapshot)(
        yield* Effect.promise(() => WorkerPool.resources(registration, input.environment)),
      )
      expect(resources.process.pid).toBe(process.pid)
      expect(resources.cpu.utilization).toBeNull()
      yield* Effect.promise(() =>
        Bun.write(report, JSON.stringify({ fingerprint: "fixture", tasks: [{ ...task, directory: "/different" }] })),
      )
      expect((yield* Effect.promise(() => WorkerPool.attention(input))).unavailable).toEqual(["assigned"])
    }),
  20_000,
)

it.live(
  "worker pool assigns independent Sessions to two actual Redcode servers",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
      const firstDirectory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
      const secondDirectory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
      const first = yield* startServer(firstDirectory.path)
      const second = yield* startServer(secondDirectory.path)
      const config = `${directory.path}/workers.json`
      const manifest = `${directory.path}/tasks.json`
      const report = `${directory.path}/report.json`
      yield* Effect.promise(async () => {
        await WorkerPool.add(config, {
          id: "first",
          url: first.base,
          passwordEnv: "WORKER_PASSWORD",
          directories: [firstDirectory.path],
          tags: [],
        })
        await WorkerPool.add(config, {
          id: "second",
          url: second.base,
          passwordEnv: "WORKER_PASSWORD",
          directories: [secondDirectory.path],
          tags: [],
        })
        await Bun.write(
          manifest,
          JSON.stringify({
            tasks: [
              { id: "one", worker: "first", prompt: "Summarize the checkout" },
              { id: "two", worker: "second", prompt: "Summarize the checkout" },
            ],
          }),
        )
      })
      const result = yield* Effect.promise(() =>
        WorkerPool.run({
          config,
          manifest,
          report,
          environment: { WORKER_PASSWORD: "secret" },
          timeoutMs: 2_000,
          pollMs: 20,
        }),
      )
      expect(result.tasks.map((task) => task.worker)).toEqual(["first", "second"])
      const firstClient = OpenCode.make({ baseUrl: first.base, headers: first.headers })
      const secondClient = OpenCode.make({ baseUrl: second.base, headers: second.headers })
      const one = result.tasks[0]!
      const two = result.tasks[1]!
      expect(
        (yield* Effect.promise(() => firstClient.session.get({ sessionID: one.sessionID! }))).location.directory,
      ).toBe(firstDirectory.path)
      expect(
        (yield* Effect.promise(() => secondClient.session.get({ sessionID: two.sessionID! }))).location.directory,
      ).toBe(secondDirectory.path)
      yield* Effect.promise(async () => {
        await expect(firstClient.session.get({ sessionID: two.sessionID! })).rejects.toThrow()
      })
      yield* Effect.promise(async () => {
        await expect(secondClient.session.get({ sessionID: one.sessionID! })).rejects.toThrow()
      })
      // These test hosts have no configured LLM provider. Admission/execution failure must never be called success.
      expect(result.tasks.every((task) => task.state !== "succeeded")).toBe(true)
    }),
  20_000,
)

it.live(
  "worker pool completes agents through real HTTP handlers and independent LLM runners",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
      const hosts = yield* Effect.forEach(["first", "second"], (id) =>
        Effect.gen(function* () {
          const checkout = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
          const llm = yield* TestLLM.Test.pipe(Effect.provide(TestLLM.testLayer()))
          if (id === "first") {
            yield* Effect.promise(async () => {
              await Bun.write(`${checkout.path}/result.txt`, "before\n")
              for (const args of [
                ["init", "-q"],
                ["add", "."],
              ]) {
                const child = Bun.spawn(["git", "-c", "core.fsmonitor=false", ...args], {
                  cwd: checkout.path,
                  stdout: "ignore",
                  stderr: "pipe",
                })
                const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
                if (code) throw new Error(stderr)
              }
            })
            yield* llm.push(
              TestLLM.tool("worker_write", "write", { path: "result.txt", content: "worker result\n" }),
              TestLLM.text(`Completed on ${id}`, id),
            )
          }
          if (id === "second") yield* llm.always(TestLLM.text(`Completed on ${id}`, id))
          const model = SessionRunnerModel.resolved(
            LanguageModel.make({ id: "worker-model", provider: "test", route: OpenAIChat.route }),
            {
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              cost: [],
              limit: { context: 200_000, output: 8_192 },
            },
          )
          const context = yield* Layer.build(
            createRoutes(
              {
                password: "secret",
                database: { path: ":memory:" },
                workers: { directory: `${checkout.path}/coordinator` },
                config: {
                  directory: checkout.path,
                  global: false,
                  project: false,
                  content: '{"worktree":{"auto":false}}',
                },
                models: { fetch: false },
                fs: { filewatcher: false, fff: false },
              },
              () => [],
              [
                llmClient.replace(Layer.succeed(LLMClient.Service, llm)),
                SessionRunnerModel.node.replace(
                  Layer.succeed(SessionRunnerModel.Service, { resolve: () => Effect.succeed(model) }),
                ),
              ],
            ).pipe(Layer.provide(HttpServer.layerServices)),
          )
          const handler = Context.get(context, HttpRouter.HttpRouter)
            .asHttpEffect()
            .pipe(HttpEffect.toWebHandlerWith(context))
          const server = Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch(request) {
              if (request.headers.get("authorization") !== `Basic ${btoa("opencode:secret")}`)
                return Response.json({}, { status: 401 })
              return handler(request)
            },
          })
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              server.stop(true)
            }),
          )
          return { id, llm, url: server.url.origin, directory: checkout.path }
        }),
      )
      const config = `${directory.path}/workers.json`
      const manifest = `${directory.path}/tasks.json`
      const report = `${directory.path}/report.json`
      yield* Effect.promise(async () => {
        await Promise.all(
          hosts.map((host) =>
            WorkerPool.add(config, {
              id: host.id,
              url: host.url,
              passwordEnv: "WORKER_PASSWORD",
              directories: [host.directory],
              tags: [],
            }),
          ),
        )
        await Bun.write(
          manifest,
          JSON.stringify({
            tasks: hosts.map((host) => ({ id: host.id, worker: host.id, prompt: "Report completion" })),
          }),
        )
      })
      const result = yield* Effect.promise(() =>
        WorkerPool.run({
          config,
          manifest,
          report,
          environment: { WORKER_PASSWORD: "secret" },
          timeoutMs: 5_000,
          pollMs: 20,
        }),
      )
      expect(result.tasks.map((task) => task.state)).toEqual(["succeeded", "succeeded"])
      expect(result.tasks.map((task) => task.text)).toEqual(["Completed on first", "Completed on second"])
      for (const host of hosts) expect((yield* host.llm.requests()).length).toBeGreaterThan(0)
      const first = hosts[0]!
      yield* Effect.promise(() => Bun.write(`${first.directory}/result.txt`, "later unrelated edit\n"))
      const artifact = yield* Effect.promise(() =>
        WorkerPool.collect({
          config,
          manifest,
          report,
          task: "first",
          output: `${directory.path}/collected`,
          environment: { WORKER_PASSWORD: "secret" },
        }),
      )
      expect(artifact.files.map((file) => file.file)).toEqual(["result.txt"])
      const patch = yield* Effect.promise(() => Bun.file(`${directory.path}/collected/changes.patch`).text())
      expect(patch).toContain("+worker result")
      expect(patch).not.toContain("later unrelated edit")
      expect(yield* Effect.promise(() => Bun.file(`${first.directory}/result.txt`).text())).toBe(
        "later unrelated edit\n",
      )

      // Acknowledged wakeups drain durable input without duplicating admission or interrupting an active drain.
      const api = OpenCode.make({ baseUrl: first.url, headers: { authorization: `Basic ${btoa("opencode:secret")}` } })
      yield* first.llm.always(TestLLM.text("Awake", "awake"))
      const session = yield* Effect.promise(() =>
        api.session.create({ title: "Wake test", location: { directory: first.directory } }),
      )
      const messageID = SessionMessage.ID.create()
      const before = (yield* first.llm.requests()).length
      yield* Effect.promise(() =>
        api.session.prompt({ sessionID: session.id, id: messageID, text: "Resume durable work", resume: false }),
      )
      expect((yield* first.llm.requests()).length).toBe(before)
      expect((yield* Effect.promise(() => api.session.inbox.list({ sessionID: session.id }))).length).toBe(1)
      yield* Effect.promise(() =>
        Promise.all([api.session.wake({ sessionID: session.id }), api.session.wake({ sessionID: session.id })]),
      )
      yield* Effect.promise(async () => {
        const deadline = Date.now() + 5_000
        while (!(await api.session.get({ sessionID: session.id })).outcome) {
          if (Date.now() > deadline) throw new Error("Woken Session did not finish")
          await Bun.sleep(20)
        }
        await api.session.prompt({ sessionID: session.id, id: messageID, text: "Ignored duplicate", resume: false })
        await api.session.wake({ sessionID: session.id })
        await Bun.sleep(100)
      })
      expect((yield* first.llm.requests()).length).toBe(before + 1)
      expect((yield* Effect.promise(() => api.session.inbox.list({ sessionID: session.id }))).length).toBe(0)
      yield* Effect.promise(async () => {
        await expect(api.session.wake({ sessionID: Session.ID.create() })).rejects.toThrow()
      })
      yield* Effect.promise(async () => {
        await expect(OpenCode.make({ baseUrl: first.url }).session.wake({ sessionID: session.id })).rejects.toThrow()
      })
    }),
  20_000,
)
