export * as SessionPlan from "./plan.js"
export { Info, Error } from "@opencode/schema/session-plan"

import { SessionPlan } from "@opencode/schema/session-plan"
import { Intelligence } from "@opencode/schema/intelligence"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { and, desc, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database.js"
import { IntelligenceEvaluation } from "../intelligence/evaluation.js"
import { SessionSchema } from "./schema.js"
import { SessionPlanTable } from "./redcode.sql.js"

const make = Effect.gen(function* () {
  const db = (yield* Database.Service).db

  const list = Effect.fn("SessionPlan.list")(function* (sessionID: SessionSchema.ID) {
    return (yield* db
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
    return yield* db
      .transaction((tx) =>
        Effect.gen(function* () {
          if (guard && !(yield* guard))
            return yield* new SessionPlan.Error({
              message: "Plan sources changed before approval; review the current request and tasks again",
            })
          const problem = validationError(input)
          if (problem) return yield* new SessionPlan.Error({ message: problem })
          const existing = (yield* tx
            .select()
            .from(SessionPlanTable)
            .where(and(eq(SessionPlanTable.session_id, input.sessionID), eq(SessionPlanTable.revision, input.revision)))
            .get())?.data
          if (existing?.tasks?.length && input.tasks && JSON.stringify(existing.tasks) !== JSON.stringify(input.tasks))
            return yield* new SessionPlan.Error({
              message: "Task decomposition is frozen for this plan revision. Revise the plan before changing its tasks.",
            })
          if (existing?.status === "approved" || (existing?.status === input.status && (existing.tasks?.length || !input.tasks?.length)))
            return existing
          if (existing) {
            yield* tx
              .update(SessionPlanTable)
              .set({ data: input, created: input.created })
              .where(and(eq(SessionPlanTable.session_id, input.sessionID), eq(SessionPlanTable.revision, input.revision)))
              .run()
              .pipe(Effect.orDie)
            return input
          }
          yield* tx
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

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@opencode/SessionPlan") {}
export const node = makeGlobalNode({ service: Service, layer: Layer.effect(Service, make), deps: [Database.node] })

export function guidance(plans: ReadonlyArray<SessionPlan.Info>) {
  const plan = plans.find((item) => item.status === "approved")
  if (!plan) return ""
  return `Plan ${plan.revision} (${plan.status}), source ${plan.path}. Use this recorded content, not a later unapproved draft.${plans[0]?.revision !== plan.revision ? ` A newer draft ${plans[0]?.revision} exists and has not been approved.` : ""}\n${plan.content}`
}

export function validationError(input: Pick<SessionPlan.Info, "content" | "tasks">) {
  if (!input.content.trim()) return "The plan is empty"
  const tasks = input.tasks ?? []
  if (tasks.some((task) =>
    !task.key.trim() ||
    !task.content.trim() ||
    !task.criterion.trim() ||
    !task.quote.trim() ||
    !input.content.includes(task.quote)
  ))
    return "Each plan task needs a key, content, acceptance criterion and exact quote from the plan"
  if (new Set(tasks.map((task) => task.key)).size !== tasks.length ||
      new Set(tasks.map((task) => task.content.trim())).size !== tasks.length)
    return "Plan task keys and contents must be unique"
}

export function review(input: {
  requests: ReadonlyArray<{ id: string; text: string }>
  content: string
  path: string
  tasks?: SessionPlan.Info["tasks"]
}) {
  const requests = input.requests.map((request) => ({
    id: request.id,
    text: IntelligenceEvaluation.evidence(request.text, { reference: request.id, limit: 5_000 }),
  }))
  const selected = requests.length <= 8 ? requests : [requests[0]!, ...requests.slice(-7)]
  return {
    sources: {
      requests: selected,
      omittedRequests: requests.length - selected.length,
      scope: "The first request and latest corrections are shown. Omitted or truncated evidence cannot prove coverage.",
    },
    candidate: {
      plan: IntelligenceEvaluation.evidence(input.content, { reference: input.path, limit: 24_000 }),
      tasks: input.tasks,
    },
    questions: IntelligenceEvaluation.questions({
      coverage: "Does the plan omit an applicable request or its verification? Treat omitted evidence as unknown.",
      decomposition: "Do the tasks omit a plan deliverable or verification, contradict the plan, or lack an observable criterion? If tasks are absent for a Plan-only goal, evaluate only the plan itself.",
      requirements: "Does the plan contradict an applicable request or later correction?",
    }),
  }
}

export function verdict(
  settings: Intelligence.Settings,
  record: Intelligence.Evaluation | undefined,
  history: ReadonlyArray<Intelligence.Evaluation> = [],
) {
  if (IntelligenceEvaluation.mode(settings) !== "dual")
    return "System One plan review: not enabled (single reasoning)."
  if (!record) return "System One plan review: unavailable; approval remains your decision."
  if (record.decision === "unavailable")
    return `System One plan review: unavailable (${IntelligenceEvaluation.issueSummary(record)}); approval remains your decision.`
  if (record.decision === "accepted") return "System One plan review: accepted."
  const issues = record.issues.map((issue) => {
    const answer = record.answers[issue]
    return `${issue}${answer?.type === "noul" ? ` (${Math.round(answer.noul * 100)}%)` : ""}`
  })
  const flags = record.issues.toSorted().join("\n")
  const repeated =
    Boolean(flags) &&
    history.some(
      (item) =>
        item.id !== record.id &&
        item.candidateID !== record.candidateID &&
        (item.decision === "needs_revision" || item.decision === "inconclusive") &&
        item.issues.toSorted().join("\n") === flags,
    )
  return `System One plan review: ${record.decision.replaceAll("_", " ")}${issues.length ? ` (${issues.join(", ")})` : ""}. Review these concerns before deciding.${repeated ? " The same concerns appeared on earlier revisions; do not revise solely to satisfy System One." : ""}`
}
