import { describe, expect } from "bun:test"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { RedRouterPlugin } from "@opencode/core/plugin/provider/red-router"
import { Effect } from "effect"
import { withEnv } from "../fixture/env"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make("red-router")

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* RedRouterPlugin.effect(host)
})

describe("RedRouterPlugin", () => {
  it.effect("asks for the API endpoint and stores it with the key", () =>
    withEnv({ RED_ROUTER_API_KEY: undefined, RED_ROUTER_BASE_URL: "https://router.example/v1" }, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const integrations = yield* Integration.Service
        expect((yield* integrations.get(integrationID))?.methods).toContainEqual({
          type: "key",
          label: "RedRouter API key",
          form: [
            {
              type: "string",
              key: "baseURL",
              title: "RedRouter API URL",
              description: "The OpenAI-compatible API endpoint, usually ending in /v1.",
              placeholder: "http://127.0.0.1:25050/v1",
              default: "https://router.example/v1",
              format: "uri",
              required: true,
            },
          ],
        })

        yield* integrations.connection.key({
          integrationID,
          key: "secret",
          answer: { baseURL: "https://router.example/v1" },
        })
        expect((yield* (yield* Credential.Service).list(integrationID))[0]?.value).toEqual(
          Credential.Key.make({
            type: "key",
            key: "secret",
            configuration: { baseURL: "https://router.example/v1" },
          }),
        )
      }),
    ),
  )
})
