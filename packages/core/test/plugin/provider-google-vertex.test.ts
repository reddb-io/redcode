import { AISDK } from "@opencode/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { GoogleVertexPlugin } from "@opencode/core/plugin/provider/google-vertex"
import { Provider } from "@opencode/core/provider"
import { Integration } from "@opencode/core/integration"
import path from "node:path"
import { fakeSelectorSdk } from "../fixture/selector"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* GoogleVertexPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

function withEnv<A, E, R>(vars: Record<string, string | undefined>, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() =>
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }),
      ),
  )
}

describe("GoogleVertexPlugin", () => {
  it.live("exposes a project/location form and reloads the provider when an ADC connection is selected", () =>
    withEnv({ CLOUDSDK_CONFIG: path.join(import.meta.dir, "fixtures", "no-gcloud") }, () =>
      Effect.gen(function* () {
        const providers = yield* Provider.Service
        const integrations = yield* Integration.Service
        yield* providers.transform((editor) =>
          editor.update(Provider.ID.googleVertex, (provider) => {
            provider.package = "@opencode/ai/providers/google-vertex"
          }),
        )
        yield* addPlugin()
        expect((yield* integrations.get(Integration.ID.make(Provider.ID.googleVertex)))?.methods).toContainEqual(
          expect.objectContaining({
            id: "google-adc",
            type: "external",
            form: expect.arrayContaining([
              expect.objectContaining({ key: "project", required: true, custom: true }),
              expect.objectContaining({ key: "location", required: true, custom: true }),
            ]),
          }),
        )
        yield* integrations.connection.external({
          integrationID: Integration.ID.make(Provider.ID.googleVertex),
          methodID: Integration.MethodID.make("google-adc"),
          answer: { project: "chosen-project", location: "eu" },
        })
        const selected = yield* providers.get(Provider.ID.googleVertex).pipe(
          Effect.filterOrFail((provider) => provider?.settings?.project === "chosen-project"),
          Effect.retry({ times: 200, schedule: Schedule.spaced("10 millis") }),
        )
        expect(selected?.settings).toMatchObject({ project: "chosen-project", location: "eu" })
      }),
    ),
  )

  it.effect("ignores OpenAI-compatible providers that are not Google Vertex", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) =>
        catalog.update(Provider.ID.opencode, (provider) => {
          provider.package = "@opencode/ai/providers/openai-compatible"
          provider.settings = { ...provider.settings, baseURL: "https://opencode.ai/zen/v1" }
        }),
      )
      yield* addPlugin()

      const provider = required(yield* catalog.get(Provider.ID.opencode))
      expect(provider.settings).toEqual({ baseURL: "https://opencode.ai/zen/v1" })
    }),
  )

  it.effect("does not configure project or location from ambient aliases", () =>
    withEnv(
      {
        GOOGLE_CLOUD_PROJECT: "google-cloud-project",
        GCP_PROJECT: "gcp-project",
        GCLOUD_PROJECT: "gcloud-project",
        GOOGLE_VERTEX_LOCATION: "google-vertex-location",
        GOOGLE_CLOUD_LOCATION: "google-cloud-location",
        VERTEX_LOCATION: "vertex-location",
      },
      () =>
        Effect.gen(function* () {
          const catalog = yield* Provider.Service
          yield* catalog.transform((catalog) =>
            catalog.update(Provider.ID.make("google-vertex"), (provider) => {
              provider.package = "@opencode/ai/providers/google-vertex/chat"
              provider.settings = {
                ...provider.settings,
                baseURL:
                  "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
              }
            }),
          )
          yield* addPlugin()
          const provider = required(yield* catalog.get(Provider.ID.make("google-vertex")))
          expect(provider.settings?.project).toBeUndefined()
          expect(provider.settings?.location).toBeUndefined()
          expect(provider.activation).toBe("auto")
          expect(provider).toMatchObject({
            package: "@opencode/ai/providers/google-vertex/chat",
            settings: {
              baseURL:
                "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
            },
          })
        }),
    ),
  )

  it.effect("enables the provider when a project resolves and leaves it automatic otherwise", () =>
    withEnv(
      {
        GOOGLE_VERTEX_PROJECT: undefined,
        GOOGLE_CLOUD_PROJECT: undefined,
        GCP_PROJECT: undefined,
        GCLOUD_PROJECT: undefined,
      },
      () =>
        Effect.gen(function* () {
          const catalog = yield* Provider.Service
          yield* catalog.transform((catalog) =>
            catalog.update(Provider.ID.make("google-vertex"), (provider) => {
              provider.package = "@opencode/ai/providers/google-vertex"
            }),
          )
          yield* addPlugin()

          expect(required(yield* catalog.get(Provider.ID.make("google-vertex"))).activation).toBe("auto")
        }),
    ),
  )

  it.effect("keeps the provider inactive when only an ambient project exists", () =>
    withEnv(
      {
        GOOGLE_VERTEX_PROJECT: undefined,
        GOOGLE_CLOUD_PROJECT: "adc-project",
        GCP_PROJECT: undefined,
        GCLOUD_PROJECT: undefined,
      },
      () =>
        Effect.gen(function* () {
          const catalog = yield* Provider.Service
          yield* catalog.transform((catalog) =>
            catalog.update(Provider.ID.make("google-vertex"), (provider) => {
              provider.package = "@opencode/ai/providers/google-vertex"
            }),
          )
          yield* addPlugin()

          expect(required(yield* catalog.get(Provider.ID.make("google-vertex"))).activation).toBe("auto")
        }),
    ),
  )

  it.effect("does not infer catalog parameters from advertised environment names", () =>
    withEnv(
      {
        GOOGLE_VERTEX_PROJECT: "vertex-project",
        GOOGLE_CLOUD_PROJECT: undefined,
        GCP_PROJECT: undefined,
        GCLOUD_PROJECT: undefined,
        GOOGLE_VERTEX_LOCATION: "europe-west4",
        GOOGLE_CLOUD_LOCATION: undefined,
        VERTEX_LOCATION: undefined,
      },
      () =>
        Effect.gen(function* () {
          const catalog = yield* Provider.Service
          yield* catalog.transform((catalog) =>
            catalog.update(Provider.ID.make("google-vertex"), (provider) => {
              provider.package = "@opencode/ai/providers/google-vertex/chat"
              provider.settings = {
                ...provider.settings,
                baseURL:
                  "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
              }
            }),
          )
          yield* addPlugin()
          const provider = required(yield* catalog.get(Provider.ID.make("google-vertex")))

          expect(provider.settings?.project).toBeUndefined()
          expect(provider.activation).toBe("auto")
          expect(provider).toMatchObject({
            package: "@opencode/ai/providers/google-vertex/chat",
            settings: {
              baseURL:
                "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
            },
          })
        }),
    ),
  )

  it.effect("keeps configured project and location over env and uses global endpoint", () =>
    withEnv(
      {
        GOOGLE_CLOUD_PROJECT: "env-project",
        GCP_PROJECT: "env-gcp-project",
        GCLOUD_PROJECT: "env-gcloud-project",
        GOOGLE_VERTEX_LOCATION: "env-location",
        GOOGLE_CLOUD_LOCATION: "env-google-cloud-location",
        VERTEX_LOCATION: "env-vertex-location",
      },
      () =>
        Effect.gen(function* () {
          const catalog = yield* Provider.Service
          const models = yield* Model.Service
          yield* catalog.transform((catalog) => {
            catalog.update(Provider.ID.make("google-vertex"), (provider) => {
              provider.package = "@opencode/ai/providers/google-vertex/chat"
              provider.settings = {
                ...provider.settings,
                baseURL:
                  "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
              }
              provider.settings = { ...provider.settings, project: "config-project", location: "global" }
            })
            catalog.models.update(Provider.ID.make("google-vertex"), Model.ID.make("gemini"), () => {})
          })
          yield* addPlugin()
          const provider = required(yield* catalog.get(Provider.ID.make("google-vertex")))
          const model = required(yield* models.get(Provider.ID.make("google-vertex"), Model.ID.make("gemini")))
          expect(provider.settings?.project).toBe("config-project")
          expect(provider.settings?.location).toBe("global")
          expect(provider).toMatchObject({
            package: "@opencode/ai/providers/google-vertex/chat",
            settings: { baseURL: "https://aiplatform.googleapis.com/v1/projects/config-project/locations/global" },
          })
          expect(model.settings).toEqual(provider.settings)
        }),
    ),
  )

  it.effect("keeps OpenAI-compatible Vertex endpoint templates regional for eu", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) =>
        catalog.update(Provider.ID.make("google-vertex"), (provider) => {
          provider.package = "@opencode/ai/providers/google-vertex/chat"
          provider.settings = {
            ...provider.settings,
            baseURL:
              "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}",
          }
          provider.settings = { ...provider.settings, project: "config-project", location: "eu" }
        }),
      )
      yield* addPlugin()
      const provider = required(yield* catalog.get(Provider.ID.make("google-vertex")))
      expect(provider).toMatchObject({
        package: "@opencode/ai/providers/google-vertex/chat",
        settings: { baseURL: "https://eu-aiplatform.googleapis.com/v1/projects/config-project/locations/eu" },
      })
    }),
  )

  it.effect("expands endpoint templates on Vertex chat models", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      const modelID = Model.ID.make("meta/llama-maas")
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.googleVertex, (provider) => {
          provider.package = "@opencode/ai/providers/google-vertex"
          provider.settings = { project: "config-project", location: "eu" }
        })
        catalog.models.update(Provider.ID.googleVertex, modelID, (model) => {
          model.package = "@opencode/ai/providers/google-vertex/chat"
          model.settings = {
            baseURL:
              "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}/endpoints/openapi",
          }
        })
      })
      yield* addPlugin()
      expect(required(yield* models.get(Provider.ID.googleVertex, modelID))).toMatchObject({
        package: "@opencode/ai/providers/google-vertex/chat",
        settings: {
          project: "config-project",
          location: "eu",
          baseURL: "https://eu-aiplatform.googleapis.com/v1/projects/config-project/locations/eu/endpoints/openapi",
        },
      })
    }),
  )

  it.effect("defaults location to us-central1 when only project is configured", () =>
    withEnv(
      {
        GOOGLE_CLOUD_PROJECT: undefined,
        GCP_PROJECT: undefined,
        GCLOUD_PROJECT: undefined,
        GOOGLE_VERTEX_LOCATION: undefined,
        GOOGLE_CLOUD_LOCATION: undefined,
        VERTEX_LOCATION: undefined,
      },
      () =>
        Effect.gen(function* () {
          const catalog = yield* Provider.Service
          yield* catalog.transform((catalog) =>
            catalog.update(Provider.ID.make("google-vertex"), (provider) => {
              provider.package = "@opencode/ai/providers/google-vertex"
              provider.settings = { ...provider.settings, project: "config-project" }
            }),
          )
          yield* addPlugin()
          const provider = required(yield* catalog.get(Provider.ID.make("google-vertex")))
          expect(provider.settings?.project).toBe("config-project")
          expect(provider.settings?.location).toBe("us-central1")
        }),
    ),
  )

  it.effect("trims model IDs before selecting language models", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("google-vertex"), Model.ID.make(" gemini-2.5-pro ")),
          modelID: Model.ID.make(" gemini-2.5-pro "),
          package: "aisdk:test-provider",
        }),
        sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
        options: {},
      })
      expect(calls).toEqual(["languageModel:gemini-2.5-pro"])
    }),
  )
})
