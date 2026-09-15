import path from "path"
import { fileURLToPath } from "url"
import { ModelsSnapshot } from "@reddb-io/redcode-core/models-snapshot"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

// Fails the build when no source yields a valid catalog, so a release never embeds an empty or
// garbage snapshot. CI verification builds set REDCODE_MODELS_SNAPSHOT=optional to embed an empty
// catalog with a warning instead; red-publish never sets it.
export const modelsData = await ModelsSnapshot.loadForBuild({
  file: process.env.MODELS_DEV_API_JSON,
  configured: [process.env.REDCODE_MODELS_URL],
  optional: process.env.REDCODE_MODELS_SNAPSHOT === "optional",
})
