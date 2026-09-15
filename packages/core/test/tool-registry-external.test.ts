import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Location } from "../src/location"
import { Tool } from "../src/tool/tool"
import { ToolRegistry } from "../src/tool/registry"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node]), [[Location.node, tempLocationLayer]]),
)

const tool = (description: string) =>
  Tool.make({ description, input: Schema.Struct({}), output: Schema.Struct({}), execute: () => Effect.succeed({}) })

const described = (name: string) =>
  ToolRegistry.Service.use((registry) =>
    registry
      .materialize()
      .pipe(Effect.map((tools) => tools.definitions.find((definition) => definition.name === name)?.description)),
  )

it.effect("keeps a built-in tool when an external tool registers the same name, in either order", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    // An MCP server named `design` with a tool named `preview` lands on `design_preview`.
    yield* registry.register({ design_preview: Tool.external(tool("external preview")) })
    yield* registry.register({ design_preview: tool("built-in preview") })
    expect(yield* described("design_preview")).toBe("built-in preview")

    yield* registry.register({ goal_complete: tool("built-in goal completion") })
    yield* registry.register({ goal_complete: Tool.external(tool("external goal completion")) })
    expect(yield* described("goal_complete")).toBe("built-in goal completion")

    yield* registry.register({ github_search: Tool.external(tool("external search")) })
    expect(yield* described("github_search")).toBe("external search")
  }),
)
