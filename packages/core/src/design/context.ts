export * as DesignContext from "./context"

import { Effect, Schema } from "effect"
import { Session } from "@reddb-io/redcode-schema/session"
import { DesignStore } from "./store"
import { DesignApproval } from "./approval"
import { SystemContext } from "../system-context/index"

const Entry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  root: Schema.String,
  revision: Schema.NullOr(Schema.String),
  ended: Schema.Boolean,
  objective: Schema.String,
  questions: Schema.Array(Schema.String),
  approval: Schema.NullOr(DesignApproval.Summary),
})

const render = (entries: readonly (typeof Entry.Type)[]) =>
  entries.length
    ? entries
        .map((entry) =>
          [
            `Design ${entry.id}: ${entry.name}. Review ${entry.ended ? "closed" : "open"}. Working revision: ${entry.revision ?? "unpublished"}.`,
            entry.approval
              ? DesignApproval.guidance(entry.approval)
              : `Work: ${entry.root}. Objective: ${entry.objective}. Open questions: ${entry.questions.join("; ")}. This design is not approved.`,
          ].join("\n"),
        )
        .join("\n\n")
    : "This Session has no Design documents or approved Design requirements."

export const load = Effect.fn(function* (sessionID: Session.ID) {
  const store = yield* DesignStore.Service
  if (!(yield* store.list(sessionID)).length) return SystemContext.empty
  return SystemContext.make({
    key: SystemContext.Key.make("design/session"),
    codec: Schema.toCodecJson(Schema.Array(Entry)),
    load: store.list(sessionID).pipe(
      Effect.flatMap((documents) =>
        Effect.forEach(documents, (document) =>
          Effect.gen(function* () {
            const record = document.approvedRevision
              ? yield* store.approval(document.id, document.approvedRevision)
              : undefined
            return {
              id: document.id,
              name: document.name,
              root: document.root,
              revision: document.revision,
              ended: document.ended,
              objective: record ? "" : document.brief.objective,
              questions: record ? [] : document.questions,
              approval: record ? DesignApproval.summary(record) : null,
            }
          }),
        ),
      ),
      Effect.orDie,
    ),
    baseline: render,
    update: (_previous, entries) =>
      entries.length
        ? render(entries)
        : "This Session no longer has Design documents. Do not rely on the previous Design context.",
    removed: () => "This Session no longer has Design documents. Do not rely on the previous Design context.",
  })
})
