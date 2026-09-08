import { expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Config } from "../src/config"
import { Location } from "../src/location"
import { MCPTools } from "../src/tool/mcp"
import { ToolRegistry } from "../src/tool/registry"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const info = Schema.decodeUnknownSync(Config.Info)({
  mcp: {
    servers: {
      fixture: {
        type: "local",
        command: [process.execPath, `${import.meta.dir}/fixture/design-mcp.ts`],
        media: { create_image: { operations: ["generate"], formats: ["image/png"], transparency: true } },
      },
    },
  },
})
const configured = Layer.succeed(
  Config.Service,
  Config.Service.of({ entries: () => Effect.succeed([new Config.Document({ type: "document", info })]) }),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([MCPTools.node, ToolRegistry.node]), [
    [Location.node, tempLocationLayer],
    [Config.node, configured],
  ]),
)
it.live(
  "discovers a paginated stdio MCP image tool through the canonical registry",
  () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.materialize()
      expect(tools.definitions.map((tool) => tool.name)).toContain("mcp_fixture_create_image")
      expect(tools.media).toEqual([
        {
          name: "mcp_fixture_create_image",
          capability: { operations: ["generate"], formats: ["image/png"], transparency: true },
        },
      ])
    }),
  30000,
)
