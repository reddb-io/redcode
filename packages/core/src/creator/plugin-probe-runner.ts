// Only imported by the CLI's explicit internal probe entrypoint, in a disposable process.
import { Effect, Layer } from "effect"
import path from "node:path"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Npm } from "@opencode/util/npm"
import { AppNodeBuilder } from "../effect/app-node-builder.js"
import { Plugin } from "../plugin.js"
import { PluginModule } from "../plugin/module.js"
import { Config } from "../config.js"
import { Location } from "../location.js"
import { AbsolutePath } from "../schema.js"
import { Project } from "../project.js"
import { Watcher } from "../filesystem/watcher.js"
import { ManagedPolicy } from "../managed-policy.js"
import { ModelsDev } from "../models-dev.js"
import { Tool } from "../tool.js"
import { Database } from "../database/database.js"
import type { CreatorPlugin } from "@opencode/schema/creator-plugin"

export async function run(root: string) {
  const directory = AbsolutePath.make(path.join(root, "package"))
  const layer = AppNodeBuilder.build(
    LayerNode.group([Plugin.node, Tool.node, Config.node, ManagedPolicy.node, Watcher.node, Npm.node]),
    [
      Location.node.replace(
        Layer.succeed(Location.Service, {
          directory,
          project: { id: Project.ID.global, directory, canonical: directory },
        }),
      ),
      Global.node.replace(
        Global.layerWith({
          home: root,
          data: root,
          cache: root,
          config: root,
          state: root,
          bin: root,
          log: root,
          repos: root,
          tmp: root,
        }),
      ),
      Config.node.replace(Config.testLayer()),
      Watcher.node.replace(Watcher.testLayer),
      Database.node.replace(Database.configured()),
      ModelsDev.node.replace(ModelsDev.configured({ fetch: false })),
    ],
  )
  const report = await Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const tools = yield* Tool.Service
    const modules = yield* PluginModule.make()
    const definition = yield* modules.load({ type: "add", target: directory, options: {} }, { install: false })
    if ("pending" in definition || "blocked" in definition)
      throw new Error("Plugin entrypoint is unavailable or blocked")
    if (!definition.id || definition.id.startsWith("opencode.")) throw new Error("Choose a non-reserved plugin ID")
    const before = new Set((yield* tools.snapshot()).definitions.map((tool) => tool.name))
    yield* plugins.activate([definition])
    const active = (yield* plugins.list()).find((item) => item.id === definition.id)
    if (active?.state.status !== "active")
      throw new Error(active?.state.status === "failed" ? active.state.error : "Plugin did not activate")
    const names = (yield* tools.snapshot()).definitions.map((tool) => tool.name).filter((name) => !before.has(name))
    yield* plugins.activate([])
    if ((yield* tools.snapshot()).definitions.some((tool) => names.includes(tool.name)))
      throw new Error("Plugin tools remained registered after teardown")
    return {
      passed: true,
      time: Date.now(),
      pluginID: definition.id,
      tools: names.slice(0, 256),
      message: `Loaded ${definition.id}; registered ${names.length} tools; teardown succeeded. Tool calls were not executed.`,
    } satisfies CreatorPlugin.Report
  }).pipe(
    Effect.scoped,
    Effect.provide(layer),
    Effect.catchCause((cause) =>
      Effect.succeed({
        passed: false,
        time: Date.now(),
        tools: [],
        message: String(cause).slice(0, 8000),
      } satisfies CreatorPlugin.Report),
    ),
    Effect.runPromise,
  )
  await Bun.write(path.join(root, "report.json"), JSON.stringify(report))
}
