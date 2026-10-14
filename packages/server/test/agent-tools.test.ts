import path from "node:path"
import { expect } from "bun:test"
import { OpenCode } from "@opencode/client/promise"
import { AgentTools } from "@opencode/core/agent-tools"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Location } from "@opencode/schema/location"
import { AbsolutePath } from "@opencode/schema/schema"
import { Worktree } from "@opencode/schema/worktree"
import { WorktreeStrategies } from "@opencode/core/worktree/strategies"
import { Permission } from "@opencode/core/permission"
import { Npm } from "@opencode/util/npm"
import { Context, Effect, Layer, Schedule, Schema, Stream } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

it.live(
  "host agent tools stay dormant until enabled, persist settings and withdraw registrations on disable",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped("redcode-agent-tools-")
      const executable = Bun.which("node")!
      const fixture = path.join(import.meta.dir, "fixture", "agent-tools-mcp.mjs")
      const launches = path.join(tmp.path, "launches")
      const command = [executable, fixture, launches]
      const attempts: string[] = []
      const context = yield* Layer.build(
        createRoutes(
          {
            password: "secret",
            database: { path: ":memory:" },
            models: { fetch: false },
            fs: { filewatcher: false, fff: false },
            config: { directory: tmp.path, global: false, project: false, content: "{}" },
          },
          () => [],
          [
            Npm.node.replace(
              Layer.succeed(Npm.Service, {
                resolve: (pkg) => Effect.succeed({ name: pkg, directory: path.join(tmp.path, "absent-package") }),
                add: (pkg) =>
                  Effect.sync(() => attempts.push(pkg)).pipe(
                    Effect.andThen(Effect.fail(new Npm.InstallFailedError({ dir: tmp.path }))),
                  ),
                check: () => Effect.die("Status must not check the registry"),
                update: () => Effect.die("Status must not update packages"),
                which: () => Effect.succeed(undefined),
              }),
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
      const location = { directory: tmp.path }
      const snapshot = yield* Effect.promise(() => api.agentTools.list())
      expect(snapshot.tools).toHaveLength(4)
      expect(snapshot.tools.every((item) => !item.settings.enabled && !item.installed)).toBe(true)
      expect(attempts).toEqual([])
      expect(yield* Effect.promise(() => Bun.file(launches).exists())).toBe(false)
      const unavailable = yield* Effect.tryPromise(() =>
        api.agentTools.configure({ id: "browser-control", settings: { enabled: true } }),
      ).pipe(Effect.result)
      expect(unavailable._tag).toBe("Failure")
      yield* Effect.promise(() =>
        api.agentTools.configure({ id: "browser-control", settings: { enabled: false, command, timeout: 12345 } }),
      )
      expect(
        (yield* Effect.promise(() => api.agentTools.list())).tools.find((item) => item.id === "browser-control")
          ?.settings,
      ).toEqual({ enabled: false, command, timeout: 12345 })
      // Reacquiring the layer reads the persisted KV settings rather than UI state.
      const restored = yield* AgentTools.Service.pipe(Effect.provide(AgentTools.layer), Effect.provide(context))
      expect((yield* restored.list()).tools.find((item) => item.id === "browser-control")?.settings.timeout).toBe(12345)
      expect(yield* Effect.promise(() => Bun.file(launches).exists())).toBe(false)
      yield* Effect.promise(() =>
        api.agentTools.configure({ id: "browser-control", settings: { enabled: true, command, timeout: 12345 } }),
      )
      yield* Effect.promise(() => api.integration.list({ location }))
      const skills = yield* Effect.promise(() => api.skill.list({ location }))
      expect(skills.data.some((skill) => skill.name === "browser-control")).toBe(true)
      const agents = yield* Effect.promise(() => api.agent.list({ location }))
      expect(agents.data.find((agent) => agent.id === "build")?.permissions).toContainEqual({
        action: "redcode_browser_control_*",
        resource: "*",
        effect: "ask",
      })
      for (const id of ["question", "explore", "title", "summary", "plan"]) {
        const agent = agents.data.find((item) => item.id === id)!
        expect(Permission.evaluate("redcode_browser_control_execute", "*", agent.permissions).effect).toBe("deny")
      }
      const connections = yield* Effect.promise(() => api.mcp.list({ location }))
      expect(
        connections.data.some(
          (connection) => connection.name === "redcode_browser_control" && connection.status.status === "connected",
        ),
      ).toBe(true)
      yield* Effect.promise(() =>
        api.agentTools.configure({ id: "browser-control", settings: { enabled: false, command } }),
      )
      const withdrawn = yield* Effect.promise(() => api.skill.list({ location })).pipe(
        Effect.repeat({
          until: (result) => !result.data.some((skill) => skill.name === "browser-control"),
          schedule: Schedule.spaced("10 millis"),
        }),
        Effect.timeout("2 seconds"),
      )
      expect(withdrawn.data.some((skill) => skill.name === "browser-control")).toBe(false)
      expect(attempts).toEqual([])
      yield* Effect.tryPromise(() => api.agentTools.install({ id: "browser-control" })).pipe(Effect.result)
      expect(attempts).toEqual(["@opencode-ai/browser-control@0.8.4"])
    }),
  30_000,
)

it.live(
  "Rift adapter preserves source paths, refuses refs and keeps child snapshots safe",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped("redcode-rift-adapter-")
      const source = AbsolutePath.make(tmp.path)
      const destination = AbsolutePath.make(path.join(tmp.path, "snapshots", "owned-snapshot"))
      const child = AbsolutePath.make(path.join(tmp.path, "child"))
      const requests: Schema.Json[] = []
      const inventory = { children: true, malformed: false }
      const status: AgentTools.Status = {
        id: "rift",
        settings: { enabled: true, copyAll: true },
        installed: true,
        supported: true,
        package: "owned-rift-fixture",
        command: ["owned-rift-fixture"],
      }
      const context = yield* Layer.build(
        createRoutes(
          {
            password: "secret",
            database: { path: ":memory:" },
            models: { fetch: false },
            fs: { filewatcher: false, fff: false },
            config: { directory: tmp.path, global: false, project: false, content: "{}" },
          },
          () => [],
          [
            AgentTools.node.replace(
              Layer.succeed(AgentTools.Service, {
                list: () =>
                  Effect.succeed({
                    host: { name: "owned-linux-fixture", platform: "linux", arch: "x64" },
                    tools: [status],
                  }),
                changes: () => Stream.empty,
                configure: () => Effect.fail(new Error("unused configuration")),
                install: () => Effect.fail(new Error("unused installation")),
                probe: () => Effect.succeed(status),
                rift: (request) =>
                  Effect.sync(() => {
                    requests.push(request)
                    const value = Schema.decodeUnknownSync(Schema.Struct({ command: Schema.String }))(request)
                    if (value.command === "create") return destination
                    if (value.command === "list") return inventory.children ? [child] : []
                    if (value.command === "descendants")
                      return inventory.malformed ? ["relative-invalid"] : [destination]
                    return null
                  }),
              }),
            ),
          ],
        ).pipe(Layer.provide(HttpServer.layerServices)),
      )
      const locations = Context.get(context, LocationServiceMap.Service)
      const location = yield* locations.contextEffect(Location.Ref.make({ directory: source }))
      const { Plugin } = yield* Effect.promise(() => import("@opencode/core/plugin"))
      yield* Context.get(location, Plugin.Service).awaitActivation
      const strategy = Context.get(location, WorktreeStrategies.Service)
        .get()
        .strategies.get(Worktree.StrategyID.make("rift"))!
      expect(yield* strategy.create({ sourceDirectory: source, directory: destination })).toEqual({
        directory: destination,
      })
      expect(requests).toEqual([
        {
          command: "create",
          from: source,
          into: path.dirname(destination),
          name: path.basename(destination),
          copyAll: true,
          hooks: false,
        },
      ])
      expect(
        (yield* strategy
          .create({ sourceDirectory: source, directory: destination, branch: "main" })
          .pipe(Effect.result))._tag,
      ).toBe("Failure")
      expect(requests).toHaveLength(1)
      expect((yield* strategy.remove({ directory: destination, force: true }).pipe(Effect.result))._tag).toBe("Failure")
      expect(
        requests.some(
          (request) =>
            Schema.decodeUnknownSync(Schema.Struct({ command: Schema.String }))(request).command === "remove",
        ),
      ).toBe(false)
      inventory.children = false
      yield* strategy.remove({ directory: destination, force: false })
      expect(requests.at(-1)).toEqual({ command: "remove", at: destination, hooks: false })
      expect(yield* strategy.list(source)).toEqual([
        { directory: source, type: "root" },
        { directory: destination, type: "worktree" },
      ])
      inventory.malformed = true
      expect((yield* strategy.list(source).pipe(Effect.result))._tag).toBe("Failure")
    }),
  30_000,
)
