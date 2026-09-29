export * as ConfigModels from "./models.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export const Info = Schema.Struct({
  sources: Schema.String.pipe(Schema.Array, optional).annotate({
    description:
      "Models catalog URLs tried in order before https://models.opencode.ai and https://models.dev, for networks that block them (a URL without a .json path gets /api.json appended). Read from the global configuration only, because the catalog cache is shared by every project; REDCODE_MODELS_URL is tried first.",
  }),
}).annotate({ identifier: "Config.Models" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
