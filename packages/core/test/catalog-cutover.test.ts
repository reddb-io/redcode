import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM } from "@opencode/ai"
import { compileRequest } from "@opencode/ai/route/client"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { ModelsDev } from "@opencode/core/models-dev"
import { ModelsDevCatalog } from "@opencode/core/models-dev/catalog"

const offering = {
  id: "fixture-model",
  name: "Fixture model",
  type: "chat",
  release_date: "2026-10-23",
  modalities: { input: ["text"], output: ["text"] },
  capabilities: { tools: { supported: true }, reasoning: { supported: false } },
  limit: { context: 1000, output: 100 },
  api: {
    "chat-completions": {
      base_url: "https://example.test/v1",
      sdk: { opencodeai: "@opencode/ai/providers/openai-compatible" },
      capabilities: { tools: { updates: true } },
    },
  },
}
const document = (id: string, sdk?: string) =>
  Schema.decodeUnknownSync(ModelsDevCatalog.Document)({
    [id]: {
      id,
      name: id,
      env: [],
      models: {
        "fixture-model": sdk
          ? { ...offering, api: { "chat-completions": { base_url: "https://example.test/v1", sdk: { aisdk: sdk } } } }
          : offering,
      },
    },
  })

test("inherits omitted capability properties from the offering instead of rejecting the catalog", () => {
  const model = ModelsDev.normalize(document("fixture"), "fixture")[0]!.models[0]!
  expect(model.enabled).toBe(true)
  expect(model.capabilities.tools).toBe(true)
  expect(model.catalog?.apis["chat-completions"]?.capabilities.tools).toEqual({ supported: true, updates: true })
})

test.each([
  ["gitlab", "gitlab-ai-provider"],
  ["sap-ai-core", "@jerome-benoit/sap-ai-provider-v2"],
  ["watsonx", "watsonx-ai-provider"],
])("retains the locally trusted %s adapter while remote SDK names stay descriptive", (id, sdk) => {
  const model = ModelsDev.normalize(document(id, sdk), "fixture")[0]!.models[0]!
  expect(model.enabled).toBe(true)
  expect(model.package).toBe(Provider.aisdk(sdk))
  expect(ModelsDev.normalize(document("untrusted", sdk), "fixture")[0]!.models[0]!.enabled).toBe(false)
  expect(ModelsDev.normalize(document(id, "unregistered-provider"), "fixture")[0]!.models[0]!.package).toBeUndefined()
})

test("applies pinned compatibility identities only when explicitly selected for the public catalog", () => {
  const own = ModelsDev.normalize(document("fixture"), "fixture")
  expect(own.map((provider) => provider.info.id)).toEqual([Provider.ID.make("fixture")])
  const publicCatalog = ModelsDev.normalize(document("fixture"), "fixture", true)
  expect(publicCatalog.some((provider) => provider.info.id === "azure-cognitive-services")).toBe(true)
  expect(publicCatalog.some((provider) => provider.info.id === "google-vertex-anthropic")).toBe(true)
})

test("committed default catalog retains stable legacy identities and round-trips every model", async () => {
  const snapshots = await Effect.runPromise(ModelsDev.bundled)
  const encode = Schema.encodeSync(Model.Info)
  const decode = Schema.decodeUnknownSync(Model.Info)
  const models = snapshots.flatMap((provider) => provider.models)
  expect(models.filter((model) => model.catalog?.format === 2).length).toBeGreaterThan(9000)
  expect(models.some((model) => model.providerID === "azure-cognitive-services" && model.id === "gpt-4-turbo")).toBe(
    true,
  )
  expect(
    models.some((model) => model.providerID === "google-vertex-anthropic" && model.id === "claude-sonnet-4-5@20250929"),
  ).toBe(true)
  models.forEach((model) => expect(decode(encode(model)).id).toBe(model.id))
  expect(ModelsDev.DEFAULT_SOURCES[0]).toBe("https://models.dev/experimental/v2.0/api.json")
})

test.each(["openai", "anthropic", "google", "openrouter", "deepseek", "xai", "groq", "cohere", "alibaba"])(
  "compiles the selected bundled %s native route without invoking a provider",
  async (id) => {
    const snapshots = await Effect.runPromise(ModelsDev.bundled)
    const source = snapshots.find((provider) => provider.info.id === id)
    const model = source?.models.find((model) => model.enabled && model.package && Provider.builtin(model.package))
    expect(model).toBeDefined()
    const adapter = await Effect.runPromise(Provider.loadPackage(model!.package!))
    const runtime = adapter.model(model!.modelID ?? model!.id, { ...model!.settings, apiKey: "fixture-only" })
    const prepared = await Effect.runPromise(
      compileRequest(LLM.request({ model: runtime, prompt: "fixture", generation: { maxTokens: 16 } })),
    )
    expect(prepared.body).toBeDefined()
    expect(String(runtime.id)).toBe(String(model!.modelID ?? model!.id))
  },
)
