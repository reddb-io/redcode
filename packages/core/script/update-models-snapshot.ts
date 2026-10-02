#!/usr/bin/env bun
import { Schema } from "effect"

// Builds consume these committed bytes, never a live catalog. --file can replay
// an archived response; --check verifies the same snapshot without network access.
const target = new URL("../src/models-dev/snapshot.txt", import.meta.url)
const manifest = new URL("../src/models-dev/snapshot.meta.json", import.meta.url)
const file = process.argv.find((arg) => arg.startsWith("--file="))?.slice("--file=".length)
const source = new URL(
  process.env.REDCODE_MODELS_URL || process.env.OPENCODE_MODELS_URL || "https://models.dev/api.json?type=all",
)
if (!source.pathname.endsWith(".json")) source.pathname = `${source.pathname.replace(/\/+$/, "")}/api.json`
if (!source.searchParams.has("type")) source.searchParams.set("type", "all")

const checking = process.argv.includes("--check")
const response = checking || file ? undefined : await fetch(source, { signal: AbortSignal.timeout(30_000) })
if (response && !response.ok) throw new Error(`Catalog request failed: HTTP ${response.status}`)
const text = checking ? await Bun.file(target).text() : file ? await Bun.file(file).text() : await response!.text()
const catalog = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        env: Schema.Array(Schema.String),
        models: Schema.Record(
          Schema.String,
          Schema.Struct({
            id: Schema.String,
            name: Schema.String,
            type: Schema.optional(Schema.String),
            limit: Schema.Struct({ context: Schema.Finite, output: Schema.Finite }),
          }),
        ),
      }),
    ),
  ),
)(text)
const models = Object.values(catalog).flatMap((provider) => Object.values(provider.models))
const counts = {
  providers: Object.keys(catalog).length,
  models: models.length,
  decisionModels: models.filter((model) => model.type === "decision").length,
}
if (counts.providers < 100 || counts.models < 1_000 || counts.decisionModels === 0)
  throw new Error("Refusing an incomplete snapshot: expected the full provider catalog including decision models")
const digest = new Bun.CryptoHasher("sha256").update(text).digest("hex")

if (checking) {
  const metadata = Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({
        source: Schema.String,
        sha256: Schema.String,
        providers: Schema.Int,
        models: Schema.Int,
        decisionModels: Schema.Int,
      }),
    ),
  )(await Bun.file(manifest).text())
  if (
    metadata.sha256 !== digest ||
    metadata.providers !== counts.providers ||
    metadata.models !== counts.models ||
    metadata.decisionModels !== counts.decisionModels
  )
    throw new Error("Snapshot bytes or catalog counts do not match snapshot.meta.json; run update-models-snapshot")
  console.log(`Verified committed models snapshot: ${counts.models} models, ${counts.decisionModels} decision models`)
  process.exit(0)
}

await Bun.write(target, text)
await Bun.write(
  manifest,
  `${JSON.stringify({ source: file ? "archived response" : source.toString(), sha256: digest, ...counts }, null, 2)}\n`,
)
console.log(
  `Wrote ${counts.providers} providers, ${counts.models} models (${Bun.file(target).size} bytes), SHA-256 ${digest}`,
)
