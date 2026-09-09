export * as DesignDocumentTool from "./document-tool"

import { Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"

export const description =
  'Create, inspect or update a design in this conversation. Always supply action. Use {"action":"list"} to inspect designs. To create, supply action="create" and input with name, journey (new/existing), engine (html/react/solid), and kind (screen/flow/comparison/deck); identify application for an existing project. Update requires id and input; reopen and refresh require id. Edit only the returned root. Persist briefing, decisions and scenarios.'

// Providers need an object at the root. Decode into the discriminated union
// afterwards so exposing conditional fields does not weaken execution validation.
export const Input = Schema.Struct({
  action: Schema.Literals(["list", "create", "update", "reopen", "refresh"]),
  id: Schema.optional(Design.ID).annotate({ description: "Required for update, reopen and refresh." }),
  input: Schema.optional(
    Schema.Struct({
      ...Design.Update.fields,
      journey: Schema.optional(Design.Journey),
      engine: Schema.optional(Design.Engine),
      kind: Schema.optional(Design.Kind),
      application: Schema.optional(Schema.String),
    }),
  ).annotate({ description: "Required for create and update. Create requires name, journey, engine and kind." }),
}).pipe(
  Schema.decodeTo(
    Schema.Union([
      Schema.Struct({ action: Schema.Literal("list") }),
      Schema.Struct({ action: Schema.Literal("create"), input: Design.Create }),
      Schema.Struct({ action: Schema.Literal("update"), id: Design.ID, input: Design.Update }),
      Schema.Struct({ action: Schema.Literal("reopen"), id: Design.ID }),
      Schema.Struct({ action: Schema.Literal("refresh"), id: Design.ID }),
    ]),
  ),
)
