export * as ConfigModels from "./models"

import { Schema } from "effect"

export class Info extends Schema.Class<Info>("ConfigV2.Models")({
  sources: Schema.Array(Schema.String).pipe(Schema.optional).annotate({
    description:
      "Models catalog URLs tried in order before https://models.opencode.ai/api.json and https://models.dev/api.json, for networks that block the public endpoints (a URL without a .json path gets /api.json appended). Read from the global configuration only, because the catalog cache is shared by every project. REDCODE_MODELS_URL is tried before these.",
  }),
}) {}
