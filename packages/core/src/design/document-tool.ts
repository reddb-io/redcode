export * as DesignDocumentTool from "./document-tool.js"

import { Schema } from "effect"
import { Design } from "@opencode/schema/design"
import { DesignIdentify } from "./identify.js"
import { DesignRounds } from "./rounds.js"

export const description =
  'Create, inspect or update a design in this conversation. Always supply action. Use {"action":"list"} to inspect designs. To create, supply action="create" and input with name, journey (new/existing), engine (html/react/solid), and kind (screen/flow/comparison/deck); identify application for an existing project. Also supply target: web (responsive frontend), app (mobile app; add platform ios or android when the request names one) or presentation (slides), judged from what the user asked for; with dual reasoning the user confirms it, and update can change it later. Update requires id and input; reopen and refresh require id. {"action":"detect"} (optional input.application) only reads files inside the project and reports the design system it detects, with per-field confidence and evidence; it never asks the user and never writes anything. When design.system is not configured, create first identifies the design system of the project and asks the user whether to adopt it: with dual reasoning System One reads the evidence; with single reasoning call detect before create, read its evidence pack and pass your conclusion as system on create. Edit only the returned root. Persist briefing, decisions, scenarios and targets (existing product files the design changes). A feedback round\'s notes are its checklist. After fixing a note (or a group of notes), mark each with update addressed: [{feedback, index, summary}], saying what you changed; a mark needs no evidence and records no outcome, and a note that already has an outcome ignores it. design_preview refuses to publish while the open round has a note with neither a mark nor an outcome. After the round\'s verify, update notes: [{feedback, index, status, reason?, evidence: {job}}] records each note as resolved, partial, unresolved or accepted, citing the verify job; unresolved and accepted need only a reason, so a note you will not change can be recorded before publishing. Each status and mark is recorded on its own: a refused one does not hold back the others, and the result says how many were recorded, why each refused one was refused, and which notes of each round still have no outcome.'

/**
 * What an update did to the note statuses and addressed marks it carried, for the agent: how many were
 * recorded, why each refused one was refused, then the status of every round that still has a note
 * without an outcome, with the reviewer's words, so the next step is on the page that reports the last
 * one. An update can record a round that a newer one has already followed, so every such round is told.
 */
export function recorded(
  document: Pick<Design.Info, "rounds" | "notes">,
  result: { readonly notes?: DesignRounds.Outcome; readonly addressed?: DesignRounds.Ticked },
) {
  const outcome = result.notes
  const recited = DesignRounds.recite(document)
  return [
    ...(outcome
      ? [
          `Notes: recorded ${outcome.recorded}${outcome.unverified.length ? ` (${outcome.unverified.length} unverified)` : ""}, refused ${outcome.refused.length}.`,
          ...DesignRounds.refusals(outcome),
          ...[...Map.groupBy(outcome.unverified, (item) => item.reason)].map(
            ([reason, items]) => `Unverified (${items.length}): ${reason}. These are recorded and need nothing more.`,
          ),
        ]
      : []),
    ...(result.addressed ? DesignRounds.marks(result.addressed) : []),
    ...(recited ? [recited] : []),
  ].join("\n")
}

// Statuses the reviewer records come from the review page only; the model's update never carries `by`.
const { by: _by, ...updateFields } = Design.Update.fields
export const AgentUpdate = Schema.Struct(updateFields)

// Providers need an object at the root. Decode into the discriminated union
// afterwards so exposing conditional fields does not weaken execution validation.
export const Input = Schema.Struct({
  action: Schema.Literals(["list", "create", "update", "reopen", "refresh", "detect"]),
  id: Schema.optional(Design.ID).annotate({ description: "Required for update, reopen and refresh." }),
  input: Schema.optional(
    Schema.Struct({
      ...updateFields,
      journey: Schema.optional(Design.Journey),
      engine: Schema.optional(Design.Engine),
      kind: Schema.optional(Design.Kind),
      application: Schema.optional(Schema.String),
    }),
  ).annotate({ description: "Required for create and update. Create requires name, journey, engine and kind." }),
  system: Schema.optional(DesignIdentify.Answer),
}).pipe(
  Schema.decodeTo(
    Schema.Union([
      Schema.Struct({ action: Schema.Literal("list") }),
      Schema.Struct({
        action: Schema.Literal("create"),
        input: Design.Create,
        system: Schema.optional(DesignIdentify.Answer),
      }),
      Schema.Struct({ action: Schema.Literal("update"), id: Design.ID, input: AgentUpdate }),
      Schema.Struct({ action: Schema.Literal("reopen"), id: Design.ID }),
      Schema.Struct({ action: Schema.Literal("refresh"), id: Design.ID }),
      Schema.Struct({
        action: Schema.Literal("detect"),
        input: Schema.optional(Schema.Struct({ application: Schema.optional(Schema.String) })),
      }),
    ]),
  ),
)
