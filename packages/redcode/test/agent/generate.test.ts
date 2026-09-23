import { afterAll, afterEach, beforeAll, expect } from "bun:test"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { ConfigV1 } from "@reddb-io/redcode-core/v1/config/config"
import { ModelsDev } from "@reddb-io/redcode-core/models-dev"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import { Effect } from "effect"
import path from "path"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Agent } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider/provider"
import { Skill } from "../../src/skill"

type ConfigModel = NonNullable<NonNullable<ConfigV1.Info["provider"]>[string]["models"]>[string]

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([Agent.node, Plugin.node, Provider.node, Auth.node, Config.node, Skill.node, RuntimeFlags.node]),
    [[RuntimeFlags.node, RuntimeFlags.layer({})]],
  ),
)

const state = {
  server: undefined as ReturnType<typeof Bun.serve> | undefined,
  replies: [] as string[],
  bodies: [] as Record<string, unknown>[],
}

beforeAll(() => {
  state.server = Bun.serve({
    port: 0,
    async fetch(req) {
      state.bodies.push((await req.json()) as Record<string, unknown>)
      const text = state.replies.shift()
      if (text === undefined) return new Response("unexpected request", { status: 500 })
      return Response.json({
        id: `msg_${state.bodies.length}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    },
  })
})

afterEach(async () => {
  state.replies.length = 0
  state.bodies.length = 0
  await disposeAllInstances()
})

afterAll(() => {
  void state.server?.stop()
})

const fixture = (
  JSON.parse(await Bun.file(path.join(import.meta.dir, "../tool/fixtures/models-api.json")).text()) as Record<
    string,
    ModelsDev.Provider
  >
).anthropic.models["claude-opus-4-6"]

const config = (modelID: string) => () => ({
  enabled_providers: ["anthropic"],
  provider: {
    anthropic: {
      name: "Anthropic",
      env: ["ANTHROPIC_API_KEY"],
      npm: "@ai-sdk/anthropic",
      api: "https://api.anthropic.com/v1",
      models: {
        [modelID]: {
          id: modelID,
          name: modelID,
          family: fixture.family,
          release_date: fixture.release_date,
          attachment: fixture.attachment,
          reasoning: fixture.reasoning,
          temperature: fixture.temperature,
          tool_call: fixture.tool_call,
          limit: fixture.limit,
          modalities: fixture.modalities,
        } as ConfigModel,
      },
      options: { apiKey: "test-anthropic-key", baseURL: `${state.server!.url.origin}/v1` },
    },
  },
})

const generated = { identifier: "code-reviewer", whenToUse: "Use this agent when...", systemPrompt: "You are..." }

it.instance(
  "generates an agent from prompted JSON when the model refuses a forced tool choice",
  () =>
    Effect.gen(function* () {
      state.replies.push("Sure, here is the agent you asked for.", "```json\n" + JSON.stringify(generated) + "\n```")
      const result = yield* Agent.Service.use((svc) =>
        svc.generate({
          description: "reviews code",
          model: { providerID: ProviderV2.ID.make("anthropic"), modelID: ModelV2.ID.make("claude-opus-5-5") },
        }),
      )
      expect(result).toEqual(generated)
      // One reply that is not JSON earns exactly one repair request, and neither forces a tool.
      expect(state.bodies).toHaveLength(2)
      for (const body of state.bodies) {
        expect(body.tool_choice).toBeUndefined()
        expect(body.tools).toBeUndefined()
      }
      expect(JSON.stringify(state.bodies[1].messages)).toContain("That reply was not a valid agent configuration")
    }),
  { config: config("claude-opus-5-5") },
)
