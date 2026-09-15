import { ModelsSnapshot } from "@reddb-io/redcode-core/models-snapshot"

// Fails the build when no source yields a valid catalog, so a release never embeds an empty or
// garbage snapshot. CI verification builds set REDCODE_MODELS_SNAPSHOT=optional to embed an empty
// catalog with a warning instead.
export const modelsData = await ModelsSnapshot.loadForBuild({
  file: process.env.MODELS_DEV_API_JSON,
  configured: [process.env.REDCODE_MODELS_URL],
  optional: process.env.REDCODE_MODELS_SNAPSHOT === "optional",
})
