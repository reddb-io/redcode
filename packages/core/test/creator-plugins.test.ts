import { expect } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Project } from "@opencode/schema/project"
import { Workspace } from "@opencode/schema/workspace"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LocationServiceMap } from "../src/location-service-map"
import { Location } from "../src/location"
import { AbsolutePath } from "../src/schema"
import { Config } from "../src/config"
import { Database } from "../src/database/database"
import { DesignStore } from "../src/design/store"
import { CreatorPlugins } from "../src/creator/plugin"
import { CreatorPluginProbe } from "../src/creator/plugin-probe"
import { Plugin } from "../src/plugin"
import { Agent } from "../src/agent"
import { Tool } from "../src/tool"
import { ManagedPolicy } from "../src/managed-policy"
import { PluginSupervisor } from "../src/plugin/supervisor"
import { SessionTable } from "../src/session/sql"
import { ProjectTable } from "../src/project/sql"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, LocationServiceMap.node, CreatorPluginProbe.node, ManagedPolicy.node]),
    [Global.node.replace(tempGlobalLayer), offlineModels, Config.node.replace(Config.testLayer())],
  ),
)

it.live(
  "Creator installer pins packages, tests away from live tools, activates through the supervisor and withdraws only its own plugin",
  () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      const ref = Location.Ref.make({ directory: AbsolutePath.make(temporary.path) })
      const installed = yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const location = yield* Location.Service
        const designs = yield* DesignStore.Service
        const installer = yield* CreatorPlugins.Service
        const plugins = yield* Plugin.Service
        const tools = yield* Tool.Service
        yield* plugins.awaitActivation
        const builtins = (yield* plugins.list())
          .filter((plugin) => plugin.source.type === "builtin")
          .map((plugin) => plugin.id)
        yield* database.db
          .insert(ProjectTable)
          .values({ id: Project.ID.global, worktree: location.directory, sandboxes: [] })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        const sessionID = Session.ID.make("ses_creator_plugins")
        yield* database.db
          .insert(SessionTable)
          .values({
            id: sessionID,
            project_id: Project.ID.global,
            directory: location.directory,
            slug: "creator-plugin",
            agent: "creator",
            version: "test",
          })
          .run()
          .pipe(Effect.orDie)
        const design = yield* designs.create(sessionID, {
          name: "Echo toolkit",
          journey: "new",
          engine: "html",
          kind: "screen",
        })
        yield* designs.collaborate(sessionID, design.id, "creator", {
          action: "define",
          expectedVersion: 0,
          contract: {
            kind: "extension",
            objective: "Echo text",
            acceptance: ["Echo tool can be called"],
            target: "server-plugin",
            entry: "server.js",
            capabilities: ["tool.register"],
            outputs: ["package"],
          },
        })
        yield* Effect.promise(async () => {
          await Bun.write(
            path.join(design.root, "package.json"),
            await Bun.file(path.join(import.meta.dir, "plugin/fixtures/creator-echo/package.json")).text(),
          )
          await Bun.write(
            path.join(design.root, "server.js"),
            await Bun.file(path.join(import.meta.dir, "plugin/fixtures/creator-echo/server.js")).text(),
          )
        })
        const revision = yield* designs.publish(sessionID, design.id, "Echo toolkit")
        const input = { sessionID, designID: design.id, revision: revision.id }
        expect(yield* installer.candidates()).toMatchObject([{ ...input, name: "Echo toolkit", entry: "server.js" }])
        expect(yield* installer.review(input)).toMatchObject({
          packageName: "creator-echo",
          packageVersion: "1.0.0",
          dependencies: [],
        })
        const item = yield* installer.install(input)
        expect(yield* installer.install(input)).toEqual(item)
        expect(item.enabled).toBe(false)
        expect((yield* tools.snapshot()).definitions.some((tool) => tool.name === "creator_echo")).toBe(false)
        expect((yield* installer.control(item.id, { expectedVersion: 1, enabled: true }).pipe(Effect.flip)).code).toBe(
          "conflict",
        )
        // An unpublished edit cannot change the package the user reviewed and installed.
        yield* Effect.promise(() =>
          Bun.write(path.join(design.root, "server.js"), "throw new Error('unpublished draft')"),
        )
        const tested = yield* installer.test(item.id, { expectedVersion: 1 })
        expect(tested.report).toMatchObject({ passed: true, pluginID: "creator.echo", tools: ["creator_echo"] })
        expect((yield* tools.snapshot()).definitions.some((tool) => tool.name === "creator_echo")).toBe(false)
        expect((yield* installer.control(item.id, { expectedVersion: 1, enabled: true }).pipe(Effect.flip)).code).toBe(
          "conflict",
        )
        const active = yield* installer.control(item.id, { expectedVersion: tested.version, enabled: true })
        expect(yield* installer.list()).toMatchObject([{ id: item.id, runtime: "active" }])
        const loaded = (yield* plugins.list()).find((plugin) => plugin.id === "creator.echo")
        if (loaded?.source.type !== "local") throw new Error("Expected a managed local plugin")
        const loadedPath = loaded.source.path
        const managed = yield* ManagedPolicy.Service
        const supervisor = yield* PluginSupervisor.Service
        yield* managed.set({
          statements: [{ action: "integration.use", resource: `plugin:${path.dirname(loadedPath)}`, effect: "deny" }],
        })
        yield* supervisor.refresh
        expect((yield* tools.snapshot()).definitions.some((tool) => tool.name === "creator_echo")).toBe(false)
        expect(yield* installer.list()).toMatchObject([{ id: item.id, enabled: true, runtime: "failed" }])
        yield* managed.set({ statements: [] })
        yield* supervisor.refresh
        const snapshot = yield* tools.snapshot()
        expect(
          yield* snapshot.execute({
            sessionID,
            agent: Agent.ID.make("creator"),
            messageID: SessionMessage.ID.make("msg_creator_plugin_test"),
            call: { type: "tool-call", name: "creator_echo", id: "call_echo", input: { text: "It works" } },
          }),
        ).toMatchObject({ content: [{ type: "text", text: "It works" }] })
        const disabled = yield* installer.control(item.id, { expectedVersion: active.version, enabled: false })
        expect((yield* tools.snapshot()).definitions.some((tool) => tool.name === "creator_echo")).toBe(false)
        expect(
          (yield* plugins.list()).filter((plugin) => plugin.source.type === "builtin").map((plugin) => plugin.id),
        ).toEqual(builtins)
        const enabledAgain = yield* installer.control(item.id, { expectedVersion: disabled.version, enabled: true })
        yield* installer.remove(item.id, { expectedVersion: enabledAgain.version })
        expect(yield* installer.list()).toEqual([])
        expect(yield* Effect.promise(() => Bun.file(loadedPath).exists())).toBe(false)
        expect((yield* designs.revision(sessionID, design.id, revision.id)).files["server.js"]).toBeDefined()
        expect((yield* tools.snapshot()).definitions.some((tool) => tool.name === "creator_echo")).toBe(false)
        return input
      }).pipe(Effect.provide(locations.get(ref)))
      // Even the same directory in a different workspace cannot see or install the originating package.
      yield* Effect.gen(function* () {
        const installer = yield* CreatorPlugins.Service
        expect(yield* installer.list()).toEqual([])
        expect(yield* installer.candidates()).toEqual([])
        expect((yield* installer.install(installed).pipe(Effect.flip)).code).toBe("not-found")
      }).pipe(Effect.provide(locations.get({ ...ref, workspaceID: Workspace.ID.make("wrk_other") })))
    }),
  60_000,
)

it.live(
  "compatibility tests report real setup failures without activating a plugin",
  () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      yield* Effect.promise(async () => {
        await Bun.write(path.join(temporary.path, "package.json"), '{"name":"broken-plugin","version":"1.0.0"}')
        await Bun.write(
          path.join(temporary.path, "server.js"),
          'export default {id:"creator.broken", async setup() { throw new Error("fixture setup exploded") }}',
        )
      })
      const probe = yield* CreatorPluginProbe.Service
      const report = yield* probe.run(temporary.path)
      expect(report.passed).toBe(false)
      expect(report.message).toContain("fixture setup exploded")
      expect(report.tools).toEqual([])
    }),
  60_000,
)
