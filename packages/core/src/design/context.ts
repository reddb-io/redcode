export * as DesignContext from "./context"

import path from "node:path"
import { Effect, Schema } from "effect"
import { Session } from "@reddb-io/redcode-schema/session"
import { DesignStore } from "./store"
import { SystemContext } from "../system-context/index"

export const load = Effect.fn(function* (sessionID: Session.ID) {
  const store = yield* DesignStore.Service
  const documents = yield* store.list(sessionID)
  if (!documents.length) return SystemContext.empty
  return SystemContext.make({
    key: SystemContext.Key.make("design/session"),
    codec: Schema.toCodecJson(Schema.String),
    load: Effect.succeed(documents).pipe(
      Effect.map((documents) =>
        documents
          .map((document) =>
            [
              `Design ${document.id}: ${document.name}. Review ${document.ended ? "closed" : "open"}. Revision ${document.revision ?? "unpublished"}. Approved ${document.approvedRevision ?? "none"}.`,
              `Work: ${document.root}. Plan: ${path.join(store.storage, document.id, "plan.md")}.`,
              `Objective: ${document.brief.objective}`,
              `Open questions: ${document.questions.join("; ")}`,
              `Design-system evidence: ${document.sources.map((source) => `${source.file} at ${source.hash}`).join("; ")}. Refresh with design_document before relying on potentially changed files.`,
            ].join("\n"),
          )
          .join("\n\n"),
      ),
    ),
    baseline: (text) => text,
    update: (_previous, text) => text,
    removed: () => "This Session no longer has Design documents. Do not rely on the previous Design context.",
  })
})
