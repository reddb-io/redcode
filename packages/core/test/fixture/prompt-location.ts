import { Config } from "@opencode/core/config"
import { Bus } from "@opencode/core/bus"
import { HookRuntime } from "@opencode/core/hook"
import { Image } from "@opencode/core/image"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import type { LocationServices } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Skill } from "@opencode/core/skill"
import { Location } from "@opencode/core/location"
import { location } from "./location"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer, LayerMap } from "effect"

// Plain-prompt unit fixtures use virtual directories.
export const promptLocationNode = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      return yield* LayerMap.make(
        (ref: Location.Ref) =>
          LayerNode.compile(
            LayerNode.group([PluginHooks.node, Image.node, Skill.node, Plugin.node, HookRuntime.node, Config.node]),
            {
              replacements: [
                Config.node.replace(Config.testLayer()),
                Location.node.replace(Layer.succeed(Location.Service, location(ref))),
                Bus.node.replace(Layer.succeed(Bus.Service, bus)),
                Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
              ],
            },
          ) as Layer.Layer<LocationServices>,
      )
    }),
  ),
  deps: [Bus.node],
})
