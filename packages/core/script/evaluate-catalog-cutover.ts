#!/usr/bin/env bun
import { Schema } from "effect"
import { Model } from "../src/model.js"
import { ModelsDev } from "../src/models-dev.js"
import { ModelsDevCatalog } from "../src/models-dev/catalog.js"

const file = process.argv.find((arg) => arg.startsWith("--file="))?.slice("--file=".length)
if (!file) throw new Error("Pass --file=<archived V2 catalog>")
const text = await Bun.file(file).text()
const document = Schema.decodeUnknownSync(Schema.fromJsonString(ModelsDevCatalog.Document))(text)
const baselineFile = process.argv.find((arg) => arg.startsWith("--baseline="))?.slice("--baseline=".length)
if (!baselineFile) throw new Error("Pass --baseline=<archived previous catalog>")
const candidates = ModelsDev.normalize(document, ModelsDev.bodyDigest(text), true)
const baselineText = await Bun.file(baselineFile).text()
const baseline = ModelsDev.normalize(
  Schema.decodeUnknownSync(Schema.fromJsonString(ModelsDevCatalog.Document))(baselineText),
  ModelsDev.bodyDigest(baselineText),
)
const encode = Schema.encodeSync(Model.Info)
const decode = Schema.decodeUnknownSync(Model.Info)
const models = candidates.flatMap((provider) => provider.models)
models.forEach((model) => decode(encode(model)))
const candidate = new Map(candidates.map((provider) => [provider.info.id, provider]))
const regressions = baseline.flatMap((provider) =>
  provider.models.flatMap((model) => {
    if (
      !model.enabled ||
      (model.type !== undefined && model.type !== "chat") ||
      model.limit.context <= 0 ||
      model.limit.output <= 0
    )
      return []
    const replacement = candidate.get(provider.info.id)?.models.find((entry) => entry.id === model.id)
    if (!replacement) return [{ provider: provider.info.id, model: model.id, reason: "absent" }]
    return replacement.enabled
      ? []
      : [{ provider: provider.info.id, model: model.id, reason: "disabled", apis: replacement.catalog?.apis }]
  }),
)
console.log(
  JSON.stringify(
    {
      digest: ModelsDev.bodyDigest(text),
      providers: candidates.length,
      models: models.length,
      enabled: models.filter((model) => model.enabled).length,
      providerActivation: candidates.filter((provider) => provider.info.activation === "auto").length,
      baselineModels: baseline.flatMap((provider) => provider.models).length,
      regressions,
    },
    null,
    2,
  ),
)

if (regressions.length) process.exitCode = 1
