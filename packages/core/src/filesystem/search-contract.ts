import { Context, Effect, Schema } from "effect"
import { FileSystem } from "@opencode/schema/filesystem"

export interface Interface {
  readonly find: (input: FileSystem.FindInput) => Effect.Effect<FileSystem.Entry[]>
}

export const Options = Schema.Struct({
  fff: Schema.optional(Schema.Boolean),
  native: Schema.optional(
    Schema.Struct({
      mode: Schema.optional(Schema.Literals(["rust", "legacy"])),
      library: Schema.optional(Schema.String),
    }),
  ),
})
export type Options = typeof Options.Type

export class Service extends Context.Service<Service, Interface>()("@opencode/FileSystem/Search") {}
