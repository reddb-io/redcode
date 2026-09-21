export * as ConfigDatabase from "./database"

import { Schema } from "effect"

export class Info extends Schema.Class<Info>("ConfigV2.Database")({
  url: Schema.String,
}) {}
