#!/usr/bin/env bun
import { Schema } from "effect"
import { ModelsDevCatalog } from "../src/models-dev/catalog.js"

// Builds consume these committed bytes, never a live catalog. --file can replay
// an archived response; --check verifies the same snapshot without network access.
const target = new URL("../src/models-dev/snapshot.txt", import.meta.url)
const manifest = new URL("../src/models-dev/snapshot.meta.json", import.meta.url)
const file = process.argv.find((arg) => arg.startsWith("--file="))?.slice("--file=".length)
const prepareMirror = process.argv.find((arg) => arg.startsWith("--prepare-mirror="))?.slice("--prepare-mirror=".length)
const verifyFile = prepareMirror ?? process.argv.find((arg) => arg.startsWith("--verify-file="))?.slice("--verify-file=".length)
const source = new URL(
  process.env.REDCODE_MODELS_URL || process.env.OPENCODE_MODELS_URL || "https://models.dev/experimental/v2.0/api.json",
)
if (!source.pathname.endsWith(".json")) source.pathname = `${source.pathname.replace(/\/+$/, "")}/api.json`
if (!source.searchParams.has("type")) source.searchParams.set("type", "all")

const checking = process.argv.includes("--check")
const response =
  checking || file || verifyFile ? undefined : await fetch(source, { signal: AbortSignal.timeout(30_000) })
if (response && !response.ok) throw new Error(`Catalog request failed: HTTP ${response.status}`)
let text = checking
  ? await Bun.file(target).text()
  : verifyFile
    ? await Bun.file(verifyFile).text()
    : file
      ? await Bun.file(file).text()
      : await response!.text()
const catalog = Schema.decodeUnknownSync(Schema.fromJsonString(ModelsDevCatalog.Document))(text)
const models = Object.values(catalog).flatMap((provider) => Object.values(provider.models))
const counts = {
  providers: Object.keys(catalog).length,
  models: models.length,
  decisionModels: models.filter((model) => model.type === "decision").length,
}
if (counts.providers < 100 || counts.models < 1_000 || counts.decisionModels === 0)
  throw new Error("Refusing an incomplete snapshot: expected the full provider catalog including decision models")

if (prepareMirror) {
  // Use the original JSON so projecting this one field preserves other upstream metadata.
  const mirror = JSON.parse(text) as typeof catalog
  let changed = 0
  const projectTools = (tools?: Pick<(typeof models)[number]["capabilities"]["tools"], "updates">) => {
    const operations = tools?.updates
    if (!tools || operations === undefined || typeof operations === "boolean") return
    Object.assign(tools, {
      updates: ModelsDevCatalog.toolUpdateOperations.every((operation) => operations.includes(operation)),
      update_operations: operations,
    })
    changed++
  }
  for (const provider of Object.values(mirror)) {
    for (const model of Object.values(provider.models)) {
      projectTools(model.capabilities.tools)
      for (const api of Object.values(model.api)) projectTools(api.capabilities?.tools)
      for (const mode of Object.values(model.experimental?.modes ?? {})) projectTools(mode.capabilities?.tools)
    }
  }
  if (changed > 0) {
    text = JSON.stringify(mirror)
    await Bun.write(prepareMirror, text)
    console.log(`Projected ${changed} tool-update declarations for older Redcode servers and retained their operations`)
  }
}
const digest = new Bun.CryptoHasher("sha256").update(text).digest("hex")

if (verifyFile) {
  console.log(
    `Verified ${counts.providers} providers, ${counts.models} models, ${counts.decisionModels} decision models; SHA-256 ${digest}`,
  )
  process.exit(0)
}

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
