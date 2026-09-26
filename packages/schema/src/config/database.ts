export * as ConfigDatabase from "./database.js"

import { Schema } from "effect"

export const Info = Schema.Struct({
  url: Schema.String.check(Schema.isNonEmpty()).annotate({ description: "RedDB database URL" }),
}).annotate({ identifier: "Config.Database" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
