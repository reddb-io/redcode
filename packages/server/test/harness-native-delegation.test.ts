import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { chmod, writeFile } from "node:fs/promises"
import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { HttpServer } from "effect/unstable/http"
import { Global } from "@opencode/util/global"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { llmClient } from "@opencode/core/effect/app-node-platform"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { ExternalDelegation } from "@opencode/core/external-delegation"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { Tool } from "@opencode/core/tool"
import { Location } from "@opencode/schema/location"
import { AbsolutePath } from "@opencode/schema/schema"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { it } from "../../core/test/lib/effect"
import { executeTool, toolIdentity } from "../../core/test/lib/tool"
import { createRoutes } from "../src/routes"
import { Harnesses } from "../src/harness"
import { LanguageModel, LLMClient } from "../../ai/src"
import { OpenAIChat } from "../../ai/src/protocols/openai-chat"
import { TestLLM } from "../../ai/src/testing"
import { resumeDelegations } from "../src/restart-continuity"

it.live(
  "server restart reconnects the same native session and delivers its result",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped("redcode-native-real-restart-")
      const fixture = path.resolve(import.meta.dir, "fixture/harness-process.ts")
      const trace = path.join(tmp.path, "wire.jsonl")
      const executable = path.join(tmp.path, process.platform === "win32" ? "codex.cmd" : "codex.sh")
      yield* Effect.promise(() =>
        writeFile(
          executable,
          process.platform === "win32"
            ? `@"${process.execPath}" "${fixture}" codex "${trace}" %*\r\n`
            : `#!/bin/sh\nexec '${process.execPath}' '${fixture}' codex '${trace}' "$@"\n`,
        ),
      )
      yield* Effect.promise(() => chmod(executable, 0o700))
      const llm = yield* TestLLM.Test.pipe(Effect.provide(TestLLM.testLayer()))
      yield* llm.always(TestLLM.hangAfter())
      const model = SessionRunnerModel.resolved(
        LanguageModel.make({ id: "fixture", provider: "test", route: OpenAIChat.route }),
        {
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          cost: [],
          limit: { context: 200_000, output: 8192 },
        },
      )
      const base = path.join(tmp.path, "global")
      const global = Global.layerWith({
        data: path.join(base, "data"),
        cache: path.join(base, "cache"),
        config: path.join(base, "config"),
        state: path.join(base, "state"),
        tmp: path.join(base, "tmp"),
        bin: path.join(base, "bin"),
        log: path.join(base, "log"),
        repos: path.join(base, "repos"),
      })
      const routes = () =>
        createRoutes(
          {
            database: { path: path.join(tmp.path, "sessions.sqlite") },
            models: { fetch: false },
            fs: { filewatcher: false, fff: false },
            config: { global: false, project: false, content: "{}" },
          },
          () => [],
          [
            Global.node.replace(global),
            llmClient.replace(Layer.succeed(LLMClient.Service, llm)),
            SessionRunnerModel.node.replace(
              Layer.succeed(SessionRunnerModel.Service, { resolve: () => Effect.succeed(model) }),
            ),
          ],
        ).pipe(Layer.provide(HttpServer.layerServices))
      const ids = yield* Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(routes())
          const harness = Context.get(context, Harnesses.Service)
          yield* Effect.promise(() => harness.configure({ driver: "codex", executable }))
          const parent = yield* Effect.promise(() =>
            harness.open({ driver: "codex", directory: AbsolutePath.make(tmp.path), delegation: true }),
          )
          yield* Effect.promise(() =>
            harness.prompt(parent.id, { id: "restart-parent", text: "delegate:redcode", delivery: "queue" }),
          )
          yield* llm.wait(1)
          const task = harness.delegationStatus(parent.id, "fixture-delegation")
          expect(task.status).toBe("running")
          const sessions = Context.get(context, Session.Service)
          const unrelated = yield* sessions.create({
            location: Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }),
          })
          yield* sessions.prompt({ sessionID: unrelated.id, text: "Unrelated task", resume: false })
          yield* sessions.resume(unrelated.id).pipe(Effect.forkScoped)
          yield* llm.wait(2)
          return { parent: parent.id, child: task.childID, unrelated: unrelated.id }
        }),
      )
      const beforeRestart = (yield* llm.requests()).length
      yield* llm.always(TestLLM.text("recovered native result", "recovered"))
      yield* Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(routes())
          const harness = Context.get(context, Harnesses.Service)
          yield* resumeDelegations(Context.get(context, SessionRestart.Service), harness)
          for (let i = 0; i < 200; i++) {
            if (harness.delegationStatus(ids.parent, "fixture-delegation").status === "completed") break
            yield* Effect.sleep("50 millis")
          }
          expect(harness.delegationStatus(ids.parent, "fixture-delegation")).toMatchObject({
            childID: ids.child,
            status: "completed",
            events: [expect.objectContaining({ text: "recovered native result" })],
          })
          for (let i = 0; i < 100; i++) {
            if ((yield* Effect.promise(() => Bun.file(trace).text())).includes("recovered native result")) break
            yield* Effect.sleep("50 millis")
          }
          expect(yield* Effect.promise(() => Bun.file(trace).text())).toContain("recovered native result")
          expect(JSON.stringify((yield* llm.requests()).slice(beforeRestart))).not.toContain("Unrelated task")
          expect((yield* Context.get(context, Session.Service).active).has(ids.unrelated)).toBe(false)
        }),
      )
      // Simulate a crash after the native Session committed its answer but before the
      // separate harness database committed the observed terminal result.
      const requestCount = (yield* llm.requests()).length
      yield* Effect.sync(() => {
        const db = new Database(path.join(base, "state", "harnesses", "harness.sqlite"))
        try {
          db.query("UPDATE harness_delegation SET phase='admitted',notified=0,finished_cursor=NULL WHERE id=?").run(
            "fixture-delegation",
          )
          db.query("DELETE FROM event WHERE run=?").run(ids.child)
        } finally {
          db.close()
        }
      })
      yield* Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(routes())
          const harness = Context.get(context, Harnesses.Service)
          yield* resumeDelegations(Context.get(context, SessionRestart.Service), harness)
          for (let i = 0; i < 100; i++) {
            if (harness.delegationStatus(ids.parent, "fixture-delegation").status === "completed") break
            yield* Effect.sleep("50 millis")
          }
          expect(harness.delegationStatus(ids.parent, "fixture-delegation")).toMatchObject({
            childID: ids.child,
            status: "completed",
            events: [expect.objectContaining({ text: "recovered native result" })],
          })
          expect((yield* llm.requests()).length).toBe(requestCount)
        }),
      )
    }),
  30_000,
)

it.live(
  "external harness receives the completed result of a real native session",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped("redcode-native-result-")
      const fixture = path.resolve(import.meta.dir, "fixture/harness-process.ts")
      const trace = path.join(tmp.path, "wire.jsonl")
      const executable = path.join(tmp.path, process.platform === "win32" ? "codex.cmd" : "codex.sh")
      yield* Effect.promise(() =>
        writeFile(
          executable,
          process.platform === "win32"
            ? `@"${process.execPath}" "${fixture}" codex "${trace}" %*\r\n`
            : `#!/bin/sh\nexec '${process.execPath}' '${fixture}' codex '${trace}' "$@"\n`,
        ),
      )
      yield* Effect.promise(() => chmod(executable, 0o700))
      const llm = yield* TestLLM.Test.pipe(Effect.provide(TestLLM.testLayer()))
      yield* llm.always(TestLLM.text("native review complete", "native"))
      const model = SessionRunnerModel.resolved(
        LanguageModel.make({ id: "fixture", provider: "test", route: OpenAIChat.route }),
        {
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          cost: [],
          limit: { context: 200_000, output: 8192 },
        },
      )
      const context = yield* Layer.build(
        createRoutes(
          {
            database: { path: ":memory:" },
            models: { fetch: false },
            fs: { filewatcher: false, fff: false },
            config: { global: false, project: false, content: "{}" },
          },
          () => [],
          [
            Global.node.replace(tempGlobalLayer),
            llmClient.replace(Layer.succeed(LLMClient.Service, llm)),
            SessionRunnerModel.node.replace(
              Layer.succeed(SessionRunnerModel.Service, { resolve: () => Effect.succeed(model) }),
            ),
          ],
        ).pipe(Layer.provide(HttpServer.layerServices)),
      )
      const harness = Context.get(context, Harnesses.Service)
      yield* Effect.promise(() => harness.configure({ driver: "codex", executable }))
      const parent = yield* Effect.promise(() =>
        harness.open({ driver: "codex", directory: AbsolutePath.make(tmp.path), delegation: true }),
      )
      yield* Effect.promise(() =>
        harness.prompt(parent.id, { id: "native-success", text: "delegate:redcode", delivery: "queue" }),
      )
      for (let i = 0; i < 200; i++) {
        const content = yield* Effect.promise(() => Bun.file(trace).text())
        if (content.includes("native review complete")) break
        yield* Effect.sleep("50 millis")
      }
      expect(harness.delegationStatus(parent.id, "fixture-delegation").status).toBe("completed")
      expect(yield* Effect.promise(() => Bun.file(trace).text())).toContain("native review complete")
    }),
  30_000,
)

it.live(
  "native session receives one durable result from a delegated harness",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped("redcode-native-harness-")
      const fixture = path.resolve(import.meta.dir, "fixture/harness-process.ts")
      const executable = path.join(tmp.path, process.platform === "win32" ? "codex.cmd" : "codex.sh")
      yield* Effect.promise(() =>
        writeFile(
          executable,
          process.platform === "win32"
            ? `@"${process.execPath}" "${fixture}" codex "${path.join(tmp.path, "wire.jsonl")}" %*\r\n`
            : `#!/bin/sh\nexec '${process.execPath}' '${fixture}' codex '${path.join(tmp.path, "wire.jsonl")}' "$@"\n`,
        ),
      )
      yield* Effect.promise(() => chmod(executable, 0o700))
      const context = yield* Layer.build(
        createRoutes(
          {
            database: { path: ":memory:" },
            models: { fetch: false },
            fs: { filewatcher: false, fff: false },
            config: { global: false, project: false, content: "{}" },
          },
          () => [],
          [Global.node.replace(tempGlobalLayer), SessionExecution.node.replace(SessionExecution.noopLayer)],
        ).pipe(Layer.provide(HttpServer.layerServices)),
      )
      const sessions = Context.get(context, Session.Service)
      const harness = Context.get(context, Harnesses.Service)
      const gateway = Context.get(context, ExternalDelegation.Service).get()
      expect(gateway).toBeDefined()
      yield* Effect.promise(() => harness.configure({ driver: "codex", executable }))
      const session = yield* sessions.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }),
        permissions: [{ action: "external_delegate", resource: "codex", effect: "allow" }],
      })
      const locations = Context.get(context, LocationServiceMap.Service)
      const instance = yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* plugins.awaitActivation
        const tools = yield* Tool.Service
        const available = yield* tools.snapshot()
        const adapter = (yield* ExternalDelegation.Service).get()
        return { names: available.definitions.map((item) => item.name), adapter }
      }).pipe(Effect.provide(locations.get(session.location)), Effect.provide(context))
      expect(instance.names).toContain("external_delegate")
      expect(instance.adapter).toBeDefined()
      const invoke = () =>
        Effect.gen(function* () {
          const registry = yield* Tool.Service
          return yield* executeTool(registry, {
            sessionID: session.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "native-integration",
              name: "external_delegate",
              input: { action: "delegate", driver: "codex", task: "review" },
            },
          })
        }).pipe(Effect.provide(locations.get(session.location)), Effect.provide(context))
      expect((yield* invoke()).status).toBe("completed")
      for (let i = 0; i < 100; i++) {
        const pending = yield* sessions.inbox(session.id)
        if (pending.length) break
        yield* Effect.sleep("50 millis")
      }
      const inbox = yield* sessions.inbox(session.id)
      expect(inbox).toHaveLength(1)
      expect(JSON.stringify(inbox[0])).toContain("fixture response")
      expect((yield* invoke()).status).toBe("completed")
      expect(yield* sessions.inbox(session.id)).toHaveLength(1)
      const parent = yield* Effect.promise(() =>
        harness.open({ driver: "codex", directory: AbsolutePath.make(tmp.path), delegation: true }),
      )
      yield* Effect.promise(() =>
        harness.prompt(parent.id, { id: "external-to-native", text: "delegate:redcode", delivery: "queue" }),
      )
      for (let i = 0; i < 100; i++) {
        if (harness.read(parent.id).events.some((event) => event.text.startsWith("DELEGATE_RESULT "))) break
        yield* Effect.sleep("50 millis")
      }
      const nativeTask = harness.delegationStatus(parent.id, "fixture-delegation")
      expect(nativeTask.driver).toBe("redcode")
      const nativeChild = yield* sessions.get(Session.ID.make(nativeTask.childID))
      expect(nativeChild.metadata).toMatchObject({ externalDelegationParent: parent.id })
      expect(nativeChild.permissions).toEqual([{ action: "*", resource: "*", effect: "ask" }])
      for (let i = 0; i < 100; i++) {
        if (harness.delegationStatus(parent.id, "fixture-delegation").status === "failed") break
        yield* Effect.sleep("50 millis")
      }
      expect(harness.delegationStatus(parent.id, "fixture-delegation").status).toBe("failed")
      for (let i = 0; i < 100; i++) {
        const trace = yield* Effect.promise(() => Bun.file(path.join(tmp.path, "wire.jsonl")).text())
        if (trace.includes("<delegated_task_result>")) break
        yield* Effect.sleep("50 millis")
      }
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "wire.jsonl")).text())).toContain(
        "<delegated_task_result>",
      )
    }),
  30_000,
)

it.live("organization-managed sessions cannot access host harness accounts through native delegation", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      createRoutes(
        {
          database: { path: ":memory:" },
          models: { fetch: false },
          fs: { filewatcher: false },
          config: { global: false, project: false, content: "{}" },
          access: { consoleURL: "http://127.0.0.1:1234", resourceID: "resource" },
        },
        () => [],
        [Global.node.replace(tempGlobalLayer)],
      ).pipe(Layer.provide(HttpServer.layerServices)),
    )
    expect(Context.get(context, ExternalDelegation.Service).get()).toBeUndefined()
  }),
)
