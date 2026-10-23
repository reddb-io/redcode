import { AISDK } from "@opencode/core/aisdk"
import { describe, expect } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Npm } from "@opencode/util/npm"
import { SapAICorePlugin } from "@opencode/core/plugin/provider/sap-ai-core"
import { Provider } from "@opencode/core/provider"
import { withEnv } from "../fixture/env"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const fixtureProvider = new URL("./fixtures/provider-factory.ts", import.meta.url).href
const it = testEffect(PluginTestLayer)
const npm = Npm.Service.of({
  add: (name) => Effect.succeed({ directory: "", name }),
  resolve: (name) => Effect.succeed({ directory: "", name }),
  check: () => Effect.succeed(false),
  update: (name) => Effect.succeed({ directory: "", name }),
  which: () => Effect.undefined,
})

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* SapAICorePlugin.effect(host).pipe(Effect.provideService(Npm.Service, npm))
})

function model(providerID: string) {
  return Model.Info.make({
    ...Model.Info.default(Provider.ID.make(providerID), Model.ID.make("sap-model")),
    modelID: Model.ID.make("sap-model"),
    package: Provider.aisdk(fixtureProvider),
  })
}

describe("SapAICorePlugin", () => {
  it.effect("forwards explicit destination and deployment options without changing the environment", () =>
    withEnv(
      {
        AICORE_SERVICE_KEY: "ambient-key",
        AICORE_DEPLOYMENT_ID: "ambient-deployment",
        AICORE_RESOURCE_GROUP: "ambient-group",
      },
      () =>
        Effect.gen(function* () {
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          const options = {
            name: "sap-ai-core",
            destination: { url: "https://sap.example", authentication: "NoAuthentication" },
            deploymentId: "chosen-deployment",
            resourceGroup: "chosen-group",
          }
          const sdk = yield* aisdk.runSDK({ model: model("sap-ai-core"), package: fixtureProvider, options })
          expect(sdk.sdk.options).toEqual(options)
          expect(process.env.AICORE_SERVICE_KEY).toBe("ambient-key")
        }),
    ),
  )

  it.effect("requires an explicit authentication choice instead of ambient service bindings", () =>
    withEnv(
      {
        AICORE_SERVICE_KEY: "ambient-key",
        AICORE_DEPLOYMENT_ID: "ambient-deployment",
        AICORE_RESOURCE_GROUP: "ambient-group",
      },
      () =>
        Effect.gen(function* () {
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          const failure = yield* aisdk
            .runSDK({ model: model("sap-ai-core"), package: fixtureProvider, options: { name: "sap-ai-core" } })
            .pipe(Effect.exit)
          expect(Exit.isFailure(failure)).toBe(true)
          if (Exit.isFailure(failure))
            expect(Cause.squash(failure.cause)).toMatchObject({
              message: "Configure an explicit SAP AI Core destination or serviceKey before using this provider",
            })
          expect(process.env.AICORE_SERVICE_KEY).toBe("ambient-key")
        }),
    ),
  )

  it.effect("preserves an explicit serviceKey choice without borrowing ambient deployment settings", () =>
    withEnv(
      {
        AICORE_SERVICE_KEY: "ambient-key",
        AICORE_DEPLOYMENT_ID: "ambient-deployment",
        AICORE_RESOURCE_GROUP: "ambient-group",
      },
      () =>
        Effect.gen(function* () {
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          const sdk = yield* aisdk.runSDK({
            model: model("sap-ai-core"),
            package: fixtureProvider,
            options: { serviceKey: "chosen-key", deploymentId: "chosen-deployment" },
          })
          expect(process.env.AICORE_SERVICE_KEY).toBe("chosen-key")
          expect(sdk.sdk.options).toEqual({ serviceKey: "chosen-key", deploymentId: "chosen-deployment" })
        }),
    ),
  )

  it.effect("uses the callable SDK for language selection", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const sdk = Object.assign((modelID: string) => ({ modelID, provider: "callable" }), {
        languageModel() {
          throw new Error("SAP AI Core should call the SDK directly")
        },
      })
      const language = yield* aisdk.runLanguage({ model: model("sap-ai-core"), sdk, options: {} })
      expect(language.language as unknown).toEqual({ modelID: "sap-model", provider: "callable" })
    }),
  )

  it.effect("ignores non-SAP AI Core providers", () =>
    withEnv(
      { AICORE_SERVICE_KEY: undefined, AICORE_DEPLOYMENT_ID: "deployment", AICORE_RESOURCE_GROUP: "resource-group" },
      () =>
        Effect.gen(function* () {
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          const sdk = yield* aisdk.runSDK({
            model: model("openai"),
            package: fixtureProvider,
            options: { name: "openai", serviceKey: "service-key" },
          })
          const language = yield* aisdk.runLanguage({
            model: model("openai"),
            sdk: () => {
              throw new Error("SAP AI Core should ignore other providers")
            },
            options: {},
          })
          expect(process.env.AICORE_SERVICE_KEY).toBeUndefined()
          expect(sdk.sdk).toBeUndefined()
          expect(language.language).toBeUndefined()
        }),
    ),
  )
})
