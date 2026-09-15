import { ModelsSnapshot } from "@reddb-io/redcode-core/models-snapshot"

// Fails the build when no source yields a valid catalog, so a release never embeds an empty
// or garbage snapshot.
export const modelsData = await ModelsSnapshot.loadForBuild({
  file: process.env.MODELS_DEV_API_JSON,
  configured: [process.env.REDCODE_MODELS_URL],
})
