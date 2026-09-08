import { expect } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "../../src/plugin"
import { PluginPromise } from "../../src/plugin/promise"
import { ToolRegistry } from "../../src/tool/registry"
import { SessionMessage } from "../../src/session/message"
import { SessionV2 } from "../../src/session"
import { AgentV2 } from "../../src/agent"
import { PluginTestLayer } from "./fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(PluginTestLayer)
it.effect("image plugins use the canonical registry, preserve argument validation and disappear on unload", () =>
  Effect.gen(function* () {
    const plugins = yield* PluginV2.Service
    const registry = yield* ToolRegistry.Service
    const plugin = PluginPromise.fromPromise({
      id: "image-test",
      setup: (context) =>
        context.tools.register({
          image_test: {
            description: "Fixture image generation",
            inputSchema: {
              type: "object",
              required: ["prompt"],
              properties: { prompt: { type: "string" } },
              additionalProperties: false,
            },
            media: { operations: ["generate", "edit"], formats: ["image/png"], transparency: true },
            execute: async () => ({ content: [{ type: "text", text: "Generated" }] }),
          },
        }),
    })
    yield* plugins.add(PluginV2.ID.make(plugin.id), plugin.effect)
    const advertised = yield* registry.materialize()
    expect(advertised.definitions.map((item) => item.name)).toContain("image_test")
    expect(advertised.media).toEqual([
      {
        name: "image_test",
        capability: { operations: ["generate", "edit"], formats: ["image/png"], transparency: true },
      },
    ])
    const input = {
      sessionID: SessionV2.ID.make("ses_image_fixture"),
      agent: AgentV2.defaultID,
      assistantMessageID: SessionMessage.ID.create(),
      call: { type: "tool-call" as const, id: "call-image", name: "image_test", input: { prompt: 42 } },
    }
    const invalid = yield* advertised.settle(input)
    expect(invalid.result.type).toBe("error")
    expect("value" in invalid.result && invalid.result.value).toContain("must be string")
    yield* plugins.remove(PluginV2.ID.make(plugin.id))
    expect((yield* registry.materialize()).media).toEqual([])
    expect((yield* advertised.settle(input)).result).toEqual({ type: "error", value: "Stale tool call: image_test" })
  }),
)
