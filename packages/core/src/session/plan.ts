export * as SessionPlan from "./plan"
export { Info, Error } from "@reddb-io/redcode-schema/session-plan"

import { SessionPlan } from "@reddb-io/redcode-schema/session-plan"
import { and, desc, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { Intelligence } from "../intelligence"
import { makeGlobalNode } from "../effect/app-node"
import { SessionSchema } from "./schema"
import { SessionPlanTable } from "./goal.sql"

const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const list = Effect.fn("SessionPlan.list")(function* (sessionID: SessionSchema.ID) {
    return (yield* database.db
      .select()
      .from(SessionPlanTable)
      .where(eq(SessionPlanTable.session_id, sessionID))
      .orderBy(desc(SessionPlanTable.created))
      .all()
      .pipe(Effect.orDie)).map((row) => row.data)
  })
  const record = Effect.fn("SessionPlan.record")(function* (
    input: SessionPlan.Info,
    guard?: Effect.Effect<boolean, SessionPlan.Error>,
  ) {
    return yield* database.db
      .transaction(() =>
        Effect.gen(function* () {
          if (guard && !(yield* guard))
            return yield* new SessionPlan.Error({
              message: "Plan sources changed before approval; review the current request and tasks before executing",
            })
          const problem = validationError(input)
          if (problem) return yield* new SessionPlan.Error({ message: problem })
          const existing = (yield* list(input.sessionID)).find((plan) => plan.revision === input.revision)
          if (existing?.tasks?.length && input.tasks && JSON.stringify(existing.tasks) !== JSON.stringify(input.tasks))
            return yield* new SessionPlan.Error({
              message:
                "Task decomposition is frozen for this plan revision. Revise the plan content before changing its tasks.",
            })
          if (
            (existing?.status === "approved" && (existing.tasks?.length || !input.tasks?.length)) ||
            (existing?.status === input.status && (existing.tasks?.length || !input.tasks?.length))
          )
            return existing
          if (existing) {
            yield* database.db
              .update(SessionPlanTable)
              .set({ data: input, created: input.created })
              .where(
                and(eq(SessionPlanTable.session_id, input.sessionID), eq(SessionPlanTable.revision, input.revision)),
              )
              .run()
              .pipe(Effect.orDie)
            return input
          }
          yield* database.db
            .insert(SessionPlanTable)
            .values({ session_id: input.sessionID, revision: input.revision, created: input.created, data: input })
            .run()
            .pipe(Effect.orDie)
          return input
        }),
      )
      .pipe(Effect.catchTag("SqlError", Effect.die))
  })
  return { list, record }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/SessionPlan") {}
export const node = makeGlobalNode({ service: Service, layer: Layer.effect(Service, make), deps: [Database.node] })

export function guidance(plans: ReadonlyArray<SessionPlan.Info>) {
  const plan = plans.find((plan) => plan.status === "approved") ?? plans[0]
  if (!plan) return ""
  return `Plan ${plan.revision} (${plan.status}), source ${plan.path}. Use this recorded content, not a later unapproved draft.${plans[0]?.revision !== plan.revision ? ` A newer draft ${plans[0].revision} exists and has not been approved.` : ""}\n${plan.content}`
}

export function validationError(input: Pick<SessionPlan.Info, "content" | "tasks">) {
  if (!input.content.trim()) return "The plan is empty"
  const keys = new Set<string>()
  const contents = new Set<string>()
  for (const task of input.tasks ?? []) {
    if (
      !task.key.trim() ||
      !task.content.trim() ||
      !task.criterion.trim() ||
      !task.quote.trim() ||
      !input.content.includes(task.quote)
    )
      return "Each plan task needs a key, content, acceptance criterion and exact quote from the plan"
    if (keys.has(task.key) || contents.has(task.content.trim())) return "Plan task keys and contents must be unique"
    keys.add(task.key)
    contents.add(task.content.trim())
  }
}

const REVIEW_LIMIT = 24_000
const OMITTED =
  "The harness shortens long evidence for size: '[... evidence omitted ...]' markers and requests it left out are not gaps in the plan, so never answer yes because content is truncated or omitted."
/** Short readings of the plan review questions, reported with S1's confidence. */
const REASONS: Record<string, string> = {
  coverage: "a request may have no matching change or verification in the plan",
  decomposition:
    "the tasks may miss a plan deliverable or verification, contradict the plan, or lack an observable criterion",
  requirements: "the plan may contradict a request or a later correction",
}

/**
 * The S1 plan review. It informs the user's decision and never replaces it. A long session keeps
 * the first request and the most recent ones (later corrections included) within the budget, so the
 * review reads the requests that shape the plan instead of a truncated transcript.
 */
export function review(input: {
  requests: ReadonlyArray<{ id: string; text: string }>
  content: string
  path: string
  reference: string
  tasks?: SessionPlan.Info["tasks"]
}) {
  const entries = input.requests.map((request) => ({
    id: request.id,
    text: Intelligence.evidence(request.text, { limit: 6_000 }).content,
  }))
  const latest = entries
    .slice(1)
    .toReversed()
    .reduce(
      (kept, entry) => {
        if (kept.full) return kept
        const size = kept.size + JSON.stringify(entry).length + 1
        return size > REVIEW_LIMIT ? { ...kept, full: true } : { entries: [entry, ...kept.entries], size, full: false }
      },
      { entries: [] as typeof entries, size: JSON.stringify(entries.slice(0, 1)).length, full: false },
    ).entries
  const selected = entries[0] ? [entries[0], ...latest] : []
  const omitted = entries.length - selected.length
  return {
    sources: {
      requests: selected,
      scope: omitted
        ? `The first request and the ${latest.length} most recent requests are shown; ${omitted} older requests between them were left out for size. Later requests and corrections take precedence. ${OMITTED}`
        : `Every user request of the session is shown. Later requests and corrections take precedence. ${OMITTED}`,
    },
    candidate: {
      plan: Intelligence.evidence(input.content, { reference: input.path, limit: REVIEW_LIMIT }),
      tasks: input.tasks,
    },
    questions: Intelligence.questions({
      coverage: `Does candidate.plan leave a request in sources.requests with no corresponding change or verification? ${OMITTED}`,
      decomposition: `Do candidate.tasks omit a deliverable or verification from candidate.plan, contradict that plan, or lack observable acceptance criteria? If tasks are absent, evaluate only the plan itself. ${OMITTED}`,
      requirements: `Does candidate.plan contradict an applicable requirement in sources.requests, accounting for later corrections? ${OMITTED}`,
    }),
  }
}

/**
 * The review as the user and the model read it: the decision, each flagged check with S1's
 * confidence and what it means, and whether earlier revisions drew the same flags. A repeated set
 * of flags across revisions stops being actionable for the model; the user decides.
 */
export function verdict(
  settings: Intelligence.Settings,
  record: Intelligence.Evaluation | undefined,
  history: ReadonlyArray<Intelligence.Evaluation> = [],
) {
  if (Intelligence.mode(settings) === "single")
    return { decision: "unverified" as const, text: `S1 plan review: ${Intelligence.UNVERIFIED}.` }
  if (!record) return { decision: "unavailable" as const, text: "S1 plan review: unavailable." }
  if (record.decision === "accepted") return { decision: record.decision, text: "S1 plan review: accepted." }
  if (record.decision === "unavailable")
    return { decision: record.decision, text: `S1 plan review: unavailable (${Intelligence.issueSummary(record)}).` }
  const reasons = record.issues.map((issue) => {
    const answer = record.answers[issue]
    const confidence = answer?.type === "noul" ? ` (${Math.round(answer.noul * 100)}%)` : ""
    return `${issue}${confidence}${REASONS[issue] ? `: ${REASONS[issue]}` : ""}`
  })
  const flags = record.issues.toSorted().join("\n")
  const repeated =
    record.issues.length > 0 &&
    history.some(
      (entry) =>
        entry.id !== record.id &&
        entry.candidateID !== record.candidateID &&
        (entry.decision === "needs_revision" || entry.decision === "inconclusive") &&
        entry.issues.toSorted().join("\n") === flags,
    )
  const label = record.decision === "needs_revision" ? "needs revision" : "inconclusive"
  return {
    decision: record.decision,
    text: `S1 plan review: ${label}${reasons.length ? ` — ${reasons.join("; ")}` : ""}.${repeated ? ` S1 keeps flagging the same axes (${record.issues.join(", ")}) across plan revisions; the user decides. Do not revise or resubmit the plan only to satisfy S1.` : ""}`,
  }
}
