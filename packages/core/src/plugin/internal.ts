export * as PluginInternal from "./internal"

import { makeLocationNode } from "../effect/app-node"
import { httpClient } from "../effect/app-node-platform"
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import { Effect, Layer, Scope } from "effect"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { CommandV2 } from "../command"
import { Config } from "../config"
import { ConfigAgentPlugin } from "../config/plugin/agent"
import { ConfigCommandPlugin } from "../config/plugin/command"
import { ConfigExternalPlugin } from "../config/plugin/external"
import { ConfigProviderPlugin } from "../config/plugin/provider"
import { ConfigReferencePlugin } from "../config/plugin/reference"
import { ConfigSkillPlugin } from "../config/plugin/skill"
import { EventV2 } from "../event"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { Integration } from "../integration"
import { Location } from "../location"
import { ModelsDev } from "../models-dev"
import { Npm } from "../npm"
import { PluginV2 } from "../plugin"
import { RuntimeInvariant } from "../invariant"
import { Reference } from "../reference"
import { SkillV2 } from "../skill"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { AgentPlugin } from "./agent"
import { CommandPlugin } from "./command"
import { ModelsDevPlugin } from "./models-dev"
import { ProviderPlugins } from "./provider"
import { SkillPlugin } from "./skill"
import { VariantPlugin } from "./variant"
import { CordisPluginHost } from "./cordis"
import { PluginProfile } from "./profile"

export type Requirements =
  | AgentV2.Service
  | Catalog.Service
  | CommandV2.Service
  | Config.Service
  | EventV2.Service
  | FileSystem.Service
  | FSUtil.Service
  | Global.Service
  | HttpClient.HttpClient
  | Integration.Service
  | Location.Service
  | ModelsDev.Service
  | Npm.Service
  | Reference.Service
  | RuntimeInvariant.Service
  | SkillV2.Service

export interface Plugin<R = never> {
  readonly id: string
  readonly effect: (context: PluginContext) => Effect.Effect<void, never, R | Scope.Scope>
}

export function define<R>(plugin: Plugin<R>) {
  return plugin
}

export const builtInIDs = () => builtIns().map((item) => PluginV2.ID.make(item.id))

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const commands = yield* CommandV2.Service
    const plugin = yield* PluginV2.Service
    const integration = yield* Integration.Service
    const agents = yield* AgentV2.Service
    const config = yield* Config.Service
    const location = yield* Location.Service
    const modelsDev = yield* ModelsDev.Service
    const npm = yield* Npm.Service
    const events = yield* EventV2.Service
    const fs = yield* FSUtil.Service
    const filesystem = yield* FileSystem.Service
    const global = yield* Global.Service
    const http = yield* HttpClient.HttpClient
    const skill = yield* SkillV2.Service
    const reference = yield* Reference.Service
    const invariants = yield* RuntimeInvariant.Service
    const profile = yield* PluginProfile.Service
    const cordis = yield* CordisPluginHost.make(plugin)
    const entries = builtIns().map((input) => {
      return {
        id: PluginV2.ID.make(input.id),
        effect: (context: PluginContext) =>
          input
            .effect(context)
            .pipe(
              Effect.provideService(Catalog.Service, catalog),
              Effect.provideService(CommandV2.Service, commands),
              Effect.provideService(Integration.Service, integration),
              Effect.provideService(AgentV2.Service, agents),
              Effect.provideService(Config.Service, config),
              Effect.provideService(Location.Service, location),
              Effect.provideService(ModelsDev.Service, modelsDev),
              Effect.provideService(Npm.Service, npm),
              Effect.provideService(EventV2.Service, events),
              Effect.provideService(FSUtil.Service, fs),
              Effect.provideService(FileSystem.Service, filesystem),
              Effect.provideService(Global.Service, global),
              Effect.provideService(HttpClient.HttpClient, http),
              Effect.provideService(SkillV2.Service, skill),
              Effect.provideService(Reference.Service, reference),
              Effect.provideService(RuntimeInvariant.Service, invariants),
            ),
      }
    })

    // Share only the host's reader: this boot keeps ownership of `apply`/`clear`, while
    // RuntimeInspection reads the active profile. The invariant report `run` returns is
    // recorded by the registry and read back through `RuntimeInvariant.results`; a failing
    // check still dies here and fails the location boot.
    yield* profile.attach(cordis.snapshot)
    yield* cordis
      .apply({ name: "internal", entries })
      .pipe(Effect.andThen(invariants.run), Effect.withSpan("PluginInternal.boot"))
  }),
)

function builtIns() {
  return [
    ConfigReferencePlugin.Plugin,
    AgentPlugin.Plugin,
    CommandPlugin.Plugin,
    SkillPlugin.Plugin,
    ModelsDevPlugin,
    ConfigAgentPlugin.Plugin,
    ConfigCommandPlugin.Plugin,
    ConfigSkillPlugin.Plugin,
    ...ProviderPlugins,
    ConfigExternalPlugin.Plugin,
    ConfigProviderPlugin.Plugin,
    VariantPlugin.Plugin,
  ] satisfies readonly Plugin<Requirements | Scope.Scope>[]
}

export const locationLayer = layer.pipe(
  Layer.provideMerge(PluginProfile.layer),
  Layer.provideMerge(Config.locationLayer),
  Layer.provideMerge(FetchHttpClient.layer),
)

export const node = makeLocationNode({
  name: "plugin-internal",
  layer,
  deps: [
    Catalog.node,
    CommandV2.node,
    PluginV2.node,
    Integration.node,
    AgentV2.node,
    Config.node,
    Location.node,
    ModelsDev.node,
    Npm.node,
    EventV2.node,
    FSUtil.node,
    FileSystem.node,
    Global.node,
    httpClient,
    SkillV2.node,
    Reference.node,
    RuntimeInvariant.node,
    PluginProfile.node,
  ],
})
