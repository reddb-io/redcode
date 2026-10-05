export * as DesignContext from "./context.js"

import { Design } from "@opencode/schema/design"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Instructions } from "../instructions/index.js"
import { SessionSchema } from "../session/schema.js"
import { DesignApproval } from "./approval.js"
import { DesignChecklist } from "./checklist.js"
import { DesignRounds } from "./rounds.js"
import { DesignStore } from "./store.js"
import { DesignSystem } from "./system.js"
import { DesignTarget } from "./target.js"

/**
 * The Session's Design documents as one instruction source, so Plan and Build receive the approved
 * requirements and implementation contract in every Context Epoch baseline, including after resume and
 * compaction, instead of depending on the one-time approval message. An approved design carries its
 * immutable approval summary; a draft carries only what locates it and its open brief. The working
 * revision is left out on purpose: every design_preview would otherwise admit a new update.
 */
const Entry = Schema.Struct({
  id: Design.ID,
  name: Schema.String,
  /** What the design is for, such as "iOS app" or "Web"; decides its viewports and playbooks. */
  target: Schema.String,
  root: Schema.String,
  ended: Schema.Boolean,
  objective: Schema.String,
  brief: Schema.optional(Design.Brief),
  decisions: Schema.optional(Schema.Array(Design.Decision)),
  questions: Schema.Array(Schema.String),
  system: Schema.String,
  approval: Schema.NullOr(DesignApproval.Summary),
  /**
   * The newest feedback round with a note still without an outcome, while the review is open. Only the
   * round is kept, never a count, so the entry changes when that condition flips or moves to another
   * round, not with every recorded note.
   */
  pending: Schema.optional(Schema.Int),
  /** Whether `pending` is the latest round, which design_read lists by default. */
  latest: Schema.optional(Schema.Boolean),
})

const render = (entries: ReadonlyArray<typeof Entry.Type>) =>
  entries
    .map((entry) =>
      [
        `Design ${entry.id}: ${entry.name}. Target: ${entry.target}. Review ${entry.ended ? "closed" : "open"}.`,
        entry.approval
          ? DesignApproval.guidance(entry.approval)
          : `Work: ${entry.root}. Objective: ${entry.objective || "Not recorded"}. Open questions: ${entry.questions.join("; ") || "None recorded"}. This design is not approved: its brief is draft project data, not a requirement.`,
        ...(!entry.approval && entry.brief
          ? [DesignChecklist.context({ brief: entry.brief, decisions: entry.decisions ?? [] })]
          : []),
        ...(entry.system ? [`Design system: ${entry.system}.`] : []),
        ...(entry.pending === undefined
          ? []
          : [
              `Round ${entry.pending} has notes without an outcome; list them with design_read {"id":"${entry.id}","section":"notes"${entry.latest ? "" : `,"round":${entry.pending}`}}`,
            ]),
      ].join("\n"),
    )
    .join("\n\n")

export interface Interface {
  readonly load: (sessionID: SessionSchema.ID) => Instructions.List
}

export class Service extends Context.Service<Service, Interface>()("@redcode/DesignContext") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const designs = yield* DesignStore.Service

    const entry = (document: Design.Info) =>
      Effect.gen(function* () {
        const record = document.approvedRevision
          ? DesignApproval.summary(yield* designs.approval(document.sessionID, document.id, document.approvedRevision))
          : null
        const pending = document.ended ? undefined : DesignRounds.open(document).at(-1)?.round
        return {
          id: document.id,
          name: document.name,
          target: DesignTarget.label(document),
          root: document.root,
          ended: document.ended,
          objective: record ? "" : document.brief.objective,
          ...(record ? {} : { brief: document.brief, decisions: document.decisions }),
          questions: record ? [] : document.questions,
          system: record
            ? ""
            : [DesignSystem.summary(document), Design.describeSystem(document.designSystem)].filter(Boolean).join("; "),
          approval: record,
          ...(pending === undefined ? {} : { pending, latest: pending === DesignRounds.latest(document)?.number }),
        }
      })

    return Service.of({
      load: (sessionID) =>
        Instructions.make<ReadonlyArray<typeof Entry.Type>>({
          key: Instructions.Key.make("design/session"),
          codec: Schema.toCodecJson(Schema.Array(Entry)),
          // An unreadable store or approval package keeps the admitted value instead of dropping the
          // approved requirements; a Session that never had a Design has nothing to keep.
          read: designs.list(sessionID).pipe(
            Effect.flatMap((documents) =>
              Effect.forEach(
                documents.toSorted((a, b) => a.id.localeCompare(b.id)),
                entry,
              ),
            ),
            Effect.map((entries) => (entries.length === 0 ? Instructions.removed : entries)),
            Effect.catch(() => Effect.succeed(Instructions.unavailable)),
          ),
          render: {
            initial: render,
            changed: (_previous, current) =>
              `The Design documents of this Session changed. This supersedes the previous Design context.\n\n${render(current)}`,
            removed: () => "This Session no longer has Design documents. Do not rely on the previous Design context.",
          },
        }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [DesignStore.node] })
