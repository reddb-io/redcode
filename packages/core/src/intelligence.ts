export * as Intelligence from "./intelligence.js"

import { randomUUID } from "node:crypto"
import { Intelligence } from "@opencode/schema/intelligence"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { and, desc, eq, inArray } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "./database/database.js"
import { KVTable } from "./kv/sql.js"
import { IntelligenceEvaluation } from "./intelligence/evaluation.js"
import { IntelligenceSettings } from "./intelligence/settings.js"
import { IntelligenceTransport } from "./intelligence/transport.js"
import { IntelligenceAnswerTable, IntelligenceEvaluationTable } from "./intelligence/sql.js"
import { SessionSchema } from "./session/schema.js"

export interface EvaluationInput {
  sessionID: string
  operation: Intelligence.Operation
  kind?: "classification" | "gate"
  subjectID?: string
  candidateID?: string
  attempt?: number
  sources: unknown
  candidate?: unknown
  questions: Record<string, Intelligence.Question>
}

const make = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const settings = yield* IntelligenceSettings.Service
  const transport = yield* IntelligenceTransport.Service
  const cache = new Map<string, Intelligence.Evaluation>()

  const evaluate = Effect.fn("Intelligence.evaluate")(function* (input: EvaluationInput) {
    const selected = yield* settings.read()
    if (!selected.enabled || IntelligenceEvaluation.mode(selected) === "single") return undefined
    const fingerprint = IntelligenceEvaluation.fingerprint({
      ...input,
      evaluator: selected.evaluator,
      policy: IntelligenceEvaluation.POLICY,
    })
    const cached = cache.get(fingerprint)
    if (cached) return cached
    const id = randomUUID()
    const created = Date.now()
    const candidate = input.candidate === undefined ? {} : { candidate: input.candidate }
    const state = { sources: input.sources, ...candidate }
    const parts =
      input.operation === "compaction" && Array.isArray(input.sources)
        ? input.sources.flatMap((source) => {
            const text = typeof source === "string" ? source : (JSON.stringify(source) ?? "null")
            return Array.from({ length: Math.max(1, Math.ceil(text.length / 12_000)) }, (_, index) =>
              text.slice(Math.max(0, index * 12_000 - 512), (index + 1) * 12_000),
            )
          })
        : undefined
    const states =
      JSON.stringify({ state, questions: input.questions }).length <= 80_000
        ? [state]
        : (parts?.map((sources, index) => ({
            sources,
            ...candidate,
            coverage: {
              sourceChunk: index + 1,
              sourceChunks: parts.length,
              scope: "Every source chunk must be evaluated before a checkpoint can be accepted.",
            },
          })) ?? [state])
    const requests = states.flatMap((item, sourceIndex) => {
      const batches = Object.entries(input.questions).reduce<Record<string, Intelligence.Question>[]>(
        (result, [questionID, question]) => {
          const last = result.at(-1)!
          if (Object.keys(last).length && JSON.stringify({ state: item, questions: { ...last, [questionID]: question } }).length > 80_000) {
            result.push({ [questionID]: question })
            return result
          }
          last[questionID] = question
          return result
        },
        [{}],
      )
      return batches.map((questions) => ({ state: item, questions, sourceIndex }))
    })
    const response =
      !selected.evaluator ||
      !Object.keys(input.questions).length ||
      !requests.length ||
      requests.some((item) => JSON.stringify({ state: item.state, questions: item.questions }).length > 80_000)
        ? Effect.fail(new IntelligenceEvaluation.Error({ message: "Evaluation sources exceed budget or configuration is incomplete" }))
        : Effect.forEach(
            requests,
            (item) =>
              transport
                .request(selected.evaluator!, "systemone", {
                  model: selected.evaluator!.model,
                  state: item.state,
                  questions: item.questions,
                })
                .pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Intelligence.Response)),
                  Effect.flatMap((answer) =>
                    Effect.try({
                      try: () => ({
                        response: answer,
                        sourceIndex: item.sourceIndex,
                        ...(input.kind === "classification"
                          ? IntelligenceEvaluation.validateClassification(item.questions, answer)
                          : IntelligenceEvaluation.decide(item.questions, answer)),
                      }),
                      catch: () => new IntelligenceEvaluation.Error({ message: "Invalid System One answers" }),
                    }),
                  ),
                ),
            { concurrency: 2 },
          ).pipe(
            Effect.map((results) => ({
              decision: results.some((item) => item.decision === "needs_revision")
                ? "needs_revision" as const
                : results.some((item) => item.decision === "inconclusive")
                  ? "inconclusive" as const
                  : "accepted" as const,
              issues: [...new Set(results.flatMap((item) => item.issues))],
              response: {
                model: results[0]!.response.model,
                answers: Object.fromEntries(
                  results.flatMap((item) =>
                    Object.entries(item.response.answers).map(([questionID, answer]) => [
                      states.length === 1 ? questionID : `${item.sourceIndex}:${questionID}`,
                      answer,
                    ]),
                  ),
                ),
                usage: results.reduce(
                  (total, item) => ({
                    input_tokens: total.input_tokens + item.response.usage.input_tokens,
                    output_tokens: total.output_tokens + item.response.usage.output_tokens,
                  }),
                  { input_tokens: 0, output_tokens: 0 },
                ),
              },
            })),
          )
    const evaluated = yield* response.pipe(Effect.either)
    const record: Intelligence.Evaluation = {
      id,
      fingerprint,
      sessionID: input.sessionID,
      operation: input.operation,
      kind: input.kind ?? "gate",
      ...(input.subjectID ? { subjectID: input.subjectID } : {}),
      ...(input.candidateID ? { candidateID: input.candidateID } : {}),
      attempt: input.attempt ?? 0,
      policy: IntelligenceEvaluation.POLICY,
      created,
      duration: Date.now() - created,
      model: evaluated._tag === "Right" ? evaluated.right.response.model : (selected.evaluator?.model ?? ""),
      ...(selected.evaluator
        ? {
            evaluator: {
              transport: selected.evaluator.transport,
              baseURL: selected.evaluator.baseURL,
              model: selected.evaluator.model,
            },
          }
        : {}),
      decision: evaluated._tag === "Right" ? evaluated.right.decision : "unavailable",
      answers: evaluated._tag === "Right" ? evaluated.right.response.answers : {},
      issues:
        evaluated._tag === "Right"
          ? evaluated.right.issues
          : [
              `Evaluation unavailable: ${evaluated.left instanceof IntelligenceEvaluation.Error ? evaluated.left.message : "Invalid System One response"}. Previous state preserved.`,
            ],
      usage:
        evaluated._tag === "Right"
          ? evaluated.right.response.usage
          : { input_tokens: 0, output_tokens: 0 },
    }
    const artifact = `redcode.intelligence.evaluation.${id}`
    const evidence = yield* Schema.decodeUnknownEffect(
      Schema.UnknownFromJsonString.pipe(Schema.decodeTo(Schema.Json)),
    )(JSON.stringify({
      evaluation: record,
      sources: input.sources,
      ...candidate,
      questions: input.questions,
    })).pipe(Effect.mapError(() => new IntelligenceEvaluation.Error({ message: "Invalid System One evidence" })))
    const answers = Object.entries(record.answers).map(([questionID, answer]) => ({
      evaluation_id: record.id,
      question_id: questionID,
      type: answer.type,
      ...(answer.type === "noul" ? { noul: answer.noul } : {}),
      ...(answer.type === "choice"
        ? { choice: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities }
        : {}),
      ...(answer.type === "score"
        ? {
            score: answer.score,
            confidence: answer.confidence,
            probabilities: answer.probabilities,
            legend: answer.legend,
          }
        : {}),
    }))
    yield* db
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.insert(KVTable).values({ key: artifact, value: evidence })
          yield* tx.insert(IntelligenceEvaluationTable).values({
            id: record.id,
            session_id: SessionSchema.ID.make(record.sessionID),
            operation: record.operation,
            evaluation_kind: record.kind ?? "gate",
            subject_id: record.subjectID,
            candidate_id: record.candidateID,
            attempt: record.attempt ?? 0,
            fingerprint: record.fingerprint,
            policy: record.policy,
            decision: record.decision,
            model: record.model,
            evaluator: record.evaluator ? { ...record.evaluator } : null,
            issues: [...record.issues],
            input_tokens: record.usage.input_tokens,
            output_tokens: record.usage.output_tokens,
            duration: record.duration,
            artifact,
            source_hash: IntelligenceEvaluation.fingerprint(input.sources),
            candidate_hash: IntelligenceEvaluation.fingerprint(input.candidate),
            time_created: record.created,
          })
          if (answers.length) yield* tx.insert(IntelligenceAnswerTable).values(answers)
        }),
      )
      .pipe(Effect.mapError(() => new IntelligenceEvaluation.Error({ message: "Unable to persist System One evaluation" })))
    if (record.decision === "accepted" || record.decision === "needs_revision") cache.set(fingerprint, record)
    return record
  })

  const history = Effect.fn("Intelligence.history")(function* (
    sessionID: string,
    options: {
      operation?: Intelligence.Operation
      subjectID?: string
      candidateID?: string
      decision?: Intelligence.Evaluation["decision"]
      limit?: number
      offset?: number
    } = {},
  ) {
    const conditions = [
      ...(sessionID ? [eq(IntelligenceEvaluationTable.session_id, SessionSchema.ID.make(sessionID))] : []),
      ...(options.operation ? [eq(IntelligenceEvaluationTable.operation, options.operation)] : []),
      ...(options.subjectID ? [eq(IntelligenceEvaluationTable.subject_id, options.subjectID)] : []),
      ...(options.candidateID ? [eq(IntelligenceEvaluationTable.candidate_id, options.candidateID)] : []),
      ...(options.decision ? [eq(IntelligenceEvaluationTable.decision, options.decision)] : []),
    ]
    const rows = yield* db
      .select()
      .from(IntelligenceEvaluationTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(IntelligenceEvaluationTable.time_created))
      .limit(Math.min(100, Math.max(1, options.limit ?? 100)))
      .offset(Math.max(0, options.offset ?? 0))
      .all()
      .pipe(Effect.orDie)
    const related = rows.length
      ? yield* db
          .select()
          .from(IntelligenceAnswerTable)
          .where(inArray(IntelligenceAnswerTable.evaluation_id, rows.map((row) => row.id)))
          .all()
          .pipe(Effect.orDie)
      : []
    return yield* Effect.forEach(rows, (row) =>
      Schema.decodeUnknownEffect(Intelligence.Evaluation)({
        id: row.id,
        fingerprint: row.fingerprint,
        sessionID: row.session_id ?? "",
        operation: row.operation,
        kind: row.evaluation_kind,
        ...(row.subject_id ? { subjectID: row.subject_id } : {}),
        ...(row.candidate_id ? { candidateID: row.candidate_id } : {}),
        attempt: row.attempt,
        policy: row.policy,
        decision: row.decision,
        model: row.model,
        ...(row.evaluator ? { evaluator: row.evaluator } : {}),
        issues: row.issues,
        answers: Object.fromEntries(
          related.filter((answer) => answer.evaluation_id === row.id).map((answer) => [answer.question_id, answerFromRow(answer)]),
        ),
        created: row.time_created,
        duration: row.duration,
        usage: { input_tokens: row.input_tokens, output_tokens: row.output_tokens },
      }).pipe(
        Effect.mapError(() => new IntelligenceEvaluation.Error({ message: "Invalid persisted evaluation history" })),
      ),
    )
  })

  const status = Effect.fn("Intelligence.status")(function* () {
    const selected = yield* settings.read()
    const transports = [
      "opencode-zen",
      "openrouter",
      "typesafe",
      "red-router",
      "cloudflare-ai-gateway",
      "vercel",
      "vivgrid",
      "nano-gpt",
    ] as const
    return {
      settings: selected,
      environment: process.env.REDCODE_REASONING ?? "",
      effective: IntelligenceEvaluation.reasoning(selected),
      evaluators: transports.map((transport) => ({
        name: transport,
        configured: selected.evaluator?.transport === transport,
        evaluator:
          selected.evaluator?.transport === transport
            ? selected.evaluator
            : IntelligenceEvaluation.evaluatorPreset(transport),
      })),
    } satisfies Intelligence.Status
  })

  return {
    read: settings.read,
    save: settings.save,
    status,
    request: transport.request,
    discover: transport.discover,
    probe: transport.probe,
    evaluate,
    history,
  }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/Intelligence") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Database.node, IntelligenceSettings.node, IntelligenceTransport.node],
})

function answerFromRow(row: typeof IntelligenceAnswerTable.$inferSelect): Intelligence.Answer {
  if (row.type === "noul" && row.noul !== null) return { type: "noul", noul: row.noul }
  if (row.type === "choice" && row.choice !== null && row.confidence !== null)
    return {
      type: "choice",
      choice: row.choice,
      confidence: row.confidence,
      probabilities: row.probabilities ?? {},
    }
  if (row.type === "score" && row.score !== null && row.confidence !== null)
    return {
      type: "score",
      score: row.score,
      confidence: row.confidence,
      probabilities: row.probabilities ?? {},
      legend: Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(row.legend ?? {}),
    }
  throw new IntelligenceEvaluation.Error({ message: `Invalid persisted ${row.type} answer` })
}
