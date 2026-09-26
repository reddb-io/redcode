export * as SessionTodoStore from "./todo-store.js"

import { createHash } from "node:crypto"
import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { SessionTodo } from "@opencode/schema/session-todo"
import { Database } from "../database/database.js"
import { Intelligence } from "../intelligence.js"
import { IntelligenceEvaluation } from "../intelligence/evaluation.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { SessionSchema } from "./schema.js"
import { SessionTaskFacts } from "./task-facts.js"
import {
  quotes,
  storedStatus,
  listTasks,
  explains,
  resolve,
  failedAttempts,
  recheck,
  read,
  refusalKind,
  firstLine,
  invalidating,
  NEEDS_EXPLANATION,
  SCOPE_CHANGE_REQUIRED,
} from "./todo-evidence.js"
import { TodoHistoryTable, TodoTable } from "./redcode.sql.js"

/** Internal transaction hooks for a plan handoff. Network and filesystem work belongs in before. */
export interface Commit {
  readonly before: Effect.Effect<void, SessionTodo.Error>
  readonly write: Effect.Effect<void, SessionTodo.Error>
}

const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const db = database.db
  const facts = yield* SessionTaskFacts.Service
  const intelligence = yield* Intelligence.Service
  // Keep publication ordered when callers opt into a shared mutation boundary.
  const lock = yield* Semaphore.make(1)

  const get = Effect.fn("SessionTodoStore.get")(function* (sessionID: SessionSchema.ID) {
    return (yield* db
      .select()
      .from(TodoTable)
      .where(eq(TodoTable.session_id, sessionID))
      .orderBy(asc(TodoTable.position))
      .all()
      .pipe(Effect.orDie)).map(read)
  })

  const reconcile = Effect.fn("SessionTodoStore.update")(function* (
    input: {
      sessionID: SessionSchema.ID
      todos: ReadonlyArray<SessionTodo.Input>
      origin?: SessionTodo.Source
      /** The assistant message issuing this update; its still-running sibling tools are not held against it. */
      messageID?: string
    },
    commit?: Commit,
  ) {
    const incoming = yield* Schema.decodeUnknownEffect(Schema.Array(SessionTodo.Input))(input.todos).pipe(
      Effect.mapError((error) => new SessionTodo.Error({ message: `Invalid task update: ${error.message}` })),
    )
    if (!incoming.length) return { todos: yield* get(input.sessionID), notes: [] }
    const settings = yield* intelligence.read().pipe(
      Effect.tap((settings) => input.origin?.type === "plan" ? Effect.void : IntelligenceEvaluation.requireConfigured(settings)),
      Effect.mapError((error) => new SessionTodo.Error({ message: error.message })),
    )
    const observed = yield* facts.load(input.sessionID)
    const baseline = yield* get(input.sessionID)
    const assessments = yield* intelligence.history(input.sessionID).pipe(Effect.orElseSucceed(() => []))
    const previous = baseline
    const seen = new Set<string>()
    // Recheck each completion proof against facts that arrive before the write commits.
    const proven = new Map<string, ReadonlyArray<SessionTaskFacts.Result>>()
    const changes = yield* Effect.forEach(incoming, (item) =>
      Effect.gen(function* () {
        const supplied = item.content?.trim()
        if (item.content !== undefined && !supplied)
          return yield* new SessionTodo.Error({ message: "Task content must not be empty" })
        const matches = previous.filter((task) =>
          item.id
            ? task.id === item.id
            : input.origin
              ? task.source?.id === input.origin.id && task.source?.key === item.planKey
              : task.content === supplied,
        )
        if (matches.length > 1)
          return yield* new SessionTodo.Error({
            message: `Multiple tasks match ${supplied}; use the task id and revision`,
          })
        const before = matches[0]
        if (item.id && !before)
          return yield* new SessionTodo.Error({
            message: `Unknown task ${item.id}; omit id when creating a task. Existing tasks: ${listTasks(previous)}`,
          })
        // An update names only what changes, so a status left out is the stored one; a new task
        // without one starts pending.
        const status = item.status ?? (before ? storedStatus(before) : "pending")
        if (!before && !supplied)
          return yield* new SessionTodo.Error({
            message: `Task content is required to create a task; supply id and revision to update an existing one. Existing tasks: ${listTasks(previous)}`,
          })
        const content = supplied ?? before!.content
        const key = before?.id ?? (input.origin?.type === "plan" ? (item.planKey ?? content) : content)
        if (seen.has(key)) return yield* new SessionTodo.Error({ message: `Duplicate task update: ${content}` })
        seen.add(key)
        if (input.origin?.type === "plan" && before) return before
        const reason = item.reason?.trim() || (before?.status === status ? before.reason : undefined)
        if ((status === "blocked" || status === "cancelled") && !reason)
          return yield* new SessionTodo.Error({
            message: `${status} requires a concrete reason; do not discard remaining work`,
          })
        const requirement = item.requirement?.trim()
        const requests = observed.requests.toSorted((a, b) => b.created - a.created)
        const latest = requests.find((entry) => !entry.pending)
        const quoted = requirement
          ? requests.find((entry) => !entry.pending && quotes(entry.text, requirement))
          : latest
        // A quote never decides whether an update is accepted: the user may write in any language
        // and the model may paraphrase or translate. A requirement that quotes no request is
        // attached to the latest real request, verbatim, and the model's wording is kept as the
        // criterion; the completion gate is unchanged, since it hangs on real verification.
        const paraphrased = requirement && !quoted ? latest : undefined
        const request = quoted ?? paraphrased
        const source =
          before?.source ??
          (input.origin
            ? { ...input.origin, quote: item.requirement ?? input.origin.quote, key: item.planKey }
            : undefined) ??
          (request
            ? {
                type: "request" as const,
                id: request.id,
                quote: quoted && requirement ? requirement : request.text,
                created: request.created,
                ...(paraphrased && requirement ? { paraphrase: requirement } : {}),
              }
            : undefined)
        if (status === "completed" && !source && before?.status !== "completed")
          return yield* new SessionTodo.Error({
            message: "Completion needs a linked user request or plan task before evidence can be checked",
          })
        const assessment = request
          ? assessments.find(
              (evaluation) => evaluation.operation === "prompt_classification" && evaluation.subjectID === request.id,
            )
          : undefined
        const priority =
          item.priority ??
          (before && Schema.is(SessionTodo.Priority)(before.priority) ? before.priority : undefined) ??
          IntelligenceEvaluation.promptPriority(assessment) ??
          "medium"
        const criterion =
          item.criterion?.trim() ||
          before?.criterion ||
          // With no request to attach at all, the requirement still says what the task must show.
          (requirement && !before?.source && (paraphrased || !source) ? requirement : undefined) ||
          (source ? content : undefined)
        // Evidence is a claim only when it cites a result; an explanation on its own asks for the
        // newest verification to be selected and says what it shows.
        const claim = item.evidence?.callID ? { ...item.evidence, callID: item.evidence.callID } : undefined
        // A task that is already complete keeps its stored evidence when re-sent without new
        // evidence; review() is what reopens it when later edits made that evidence stale.
        const kept = before?.status === "completed" && !claim ? before.evidence : undefined
        const resolved =
          status === "completed" && source && !kept
            ? resolve({
                observed,
                claim,
                source,
                content,
                messageID: input.messageID,
                task: before ? { id: before.id, revision: before.revision } : undefined,
                reason: item.reason?.trim() || undefined,
                // A criterion that only restates the task explains nothing about a check.
                fallback:
                  item.reason?.trim() ||
                  (claim ? undefined : item.evidence?.explanation?.trim()) ||
                  explains(item.criterion, content) ||
                  // A paraphrase kept as the criterion restates the request; it explains no check.
                  explains(before?.criterion === before?.source?.paraphrase ? undefined : before?.criterion, content),
              })
            : undefined
        // Two failed completion attempts in a row for one task inside a turn is a loop, not a
        // request for a third message; the task blocks with the last error instead.
        // A missing explanation is a format problem with a genuine proof: it is refused every
        // time until the model supplies one, and never counts toward blocking the task.
        if (resolved && "error" in resolved && resolved.error.startsWith(NEEDS_EXPLANATION))
          return yield* new SessionTodo.Error({ message: resolved.error })
        const attempts =
          resolved && "error" in resolved && before
            ? failedAttempts(
                observed.results,
                before,
                observed.requests.reduce((max, entry) => Math.max(max, entry.created), 0),
              )
            : 0
        if (resolved && "error" in resolved && !attempts)
          return yield* new SessionTodo.Error({ message: resolved.error })
        const capped =
          resolved && "error" in resolved
            ? `completion evidence could not be verified after ${attempts + 1} attempts: ${resolved.error}`
            : undefined
        const proof = resolved && "proof" in resolved ? resolved : undefined
        // A scope change follows the same policy as a requirement: a quote of a real user message
        // links it, anything else is attached to the latest real request with the model's words
        // kept as the paraphrase. What it cannot do without is the concrete reason checked above.
        const changeQuote = item.scopeChange?.quote?.trim()
        const changeLinked =
          item.scopeChange && changeQuote
            ? observed.requests.find(
                (entry) =>
                  !entry.pending && entry.id === item.scopeChange?.messageID && quotes(entry.text, changeQuote),
              )
            : undefined
        const changeRequest = changeLinked ?? (item.scopeChange ? latest : undefined)
        if (status === "cancelled" && source && before?.status !== "cancelled" && !item.scopeChange)
          return yield* new SessionTodo.Error({
            message: `${SCOPE_CHANGE_REQUIRED} include scopeChange naming the user message that removed this work, e.g. {"scopeChange":{"messageID":"<user message id>","quote":"<the instruction, quoted or paraphrased>"},"reason":"<concrete reason>"}`,
          })
        const id =
          before?.id ??
          (input.origin?.type === "plan"
            ? `todo_${createHash("sha256")
                .update(`${input.sessionID}:${input.origin.id}:${item.planKey ?? content}`)
                .digest("hex")
                .slice(0, 24)}`
            : `todo_${crypto.randomUUID()}`)
        if (proof) proven.set(id, proof.proofs)
        return {
          id,
          revision: before?.revision ?? 1,
          content,
          status: capped ? ("blocked" as const) : status,
          priority,
          ...(source ? { source } : {}),
          ...(criterion ? { criterion } : {}),
          ...(status === "completed" && kept ? { evidence: kept } : {}),
          ...(status === "completed" && proof
            ? {
                evidence: {
                  callID: proof.proof.callID,
                  messageID: proof.proof.messageID,
                  tool: proof.proof.tool,
                  hash: proof.proof.hash,
                  observed: proof.proof.completed,
                  explanation: proof.explanation,
                },
              }
            : {}),
          ...(item.scopeChange
            ? {
                scopeChange: changeRequest
                  ? {
                      messageID: changeRequest.id,
                      quote: changeLinked ? changeQuote! : changeRequest.text,
                      created: changeRequest.created,
                      ...(!changeLinked && changeQuote ? { paraphrase: changeQuote } : {}),
                    }
                  : {
                      // No user request to link to at all: the change stands on the model's words.
                      messageID: item.scopeChange.messageID ?? "",
                      quote: changeQuote ?? "",
                      ...(changeQuote ? { paraphrase: changeQuote } : {}),
                    },
              }
            : before?.scopeChange
              ? { scopeChange: before.scopeChange }
              : {}),
          ...(capped ? { reason: capped } : reason ? { reason } : {}),
          ...(before?.legacyStatus ? { legacyStatus: before.legacyStatus } : {}),
          // When the task closed, so a live panel can keep closed tasks only while fresh.
          // Reopening drops the stamp.
          closedAt: status === "completed" || status === "cancelled" ? (before?.closedAt ?? Date.now()) : undefined,
        }
      }),
    )
    const merged = previous
      .map((task) => changes.find((item) => item.id === task.id) ?? task)
      .concat(changes.filter((task) => !previous.some((item) => item.id === task.id)))
    // Updating one task never removes another. The first actionable task advances automatically.
    const current =
      changes.find((task) => task.status === "in_progress") ??
      merged.find((task) => task.status === "in_progress") ??
      merged.find((task) => task.status === "pending")
    const result = merged.map((task) => {
      const status = task.id === current?.id ? "in_progress" : task.status === "in_progress" ? "pending" : task.status
      const before = previous.find((item) => item.id === task.id)
      const unchanged =
        before &&
        before.content === task.content &&
        before.status === status &&
        before.priority === task.priority &&
        before.reason === task.reason &&
        SessionTaskFacts.hash(before.source) === SessionTaskFacts.hash(task.source) &&
        SessionTaskFacts.hash(before.criterion) === SessionTaskFacts.hash(task.criterion) &&
        SessionTaskFacts.hash(before.evidence) === SessionTaskFacts.hash(task.evidence) &&
        SessionTaskFacts.hash(before.scopeChange) === SessionTaskFacts.hash(task.scopeChange) &&
        before.closedAt === task.closedAt
      return unchanged ? before : { ...task, status, revision: before ? before.revision + 1 : 1 }
    })
    // Compare against the reconciled state, including automatic promotion, for exact retries.
    yield* Effect.forEach(incoming, (item) =>
      Effect.gen(function* () {
        if (item.revision === undefined) return
        const before = previous.find((task) => (item.id ? task.id === item.id : task.content === item.content?.trim()))
        if (!before) return
        const after = result.find((task) => task.id === before.id)!
        if (item.revision !== before.revision && after.revision !== before.revision)
          return yield* new SessionTodo.Error({
            message: `Task ${before.id} changed; its current revision is ${before.revision}. Resend with that revision, e.g. {"todos":[{"id":"${before.id}","revision":${before.revision},"status":"${storedStatus(before)}"}]}`,
          })
      }),
    )
    // Judge each changed requirement against its own source and cited proof. Unrelated historical
    // tool output cannot crowd out the actual evidence or stand in for a missing result.
    const semantic = yield* Effect.forEach(changes, (task) => {
      const candidate = [
        {
          ...task,
          ...(task.source
            ? {
                source: {
                  ...task.source,
                  quote: IntelligenceEvaluation.evidence(task.source.quote, { reference: task.source.id, limit: 8000 }),
                },
              }
            : {}),
        },
      ]
      const latest = observed.requests.filter((request) => !request.pending).at(-1)
      const requests = observed.requests.filter(
        (request) =>
          !request.pending &&
          (request.id === task.source?.id ||
            request.id === task.scopeChange?.messageID ||
            request.id === latest?.id ||
            (task.source !== undefined && request.created >= task.source.created)),
      )
      const results =
        proven.get(task.id) ??
        observed.results.filter(
          (result) =>
            result.settled && result.callID === task.evidence?.callID && result.messageID === task.evidence?.messageID,
        )
      const review = intelligence
        .evaluate({
          sessionID: input.sessionID,
          operation: task.status === "completed" ? "task_completion" : "task_quality",
          subjectID: task.id,
          sources: {
            requests: requests.map((request) => ({
              id: request.id,
              text: IntelligenceEvaluation.evidence(request.text, { reference: request.id, limit: 8000 }),
            })),
            previous: baseline
              .filter((previous) => previous.id === task.id)
              .map((previous) => ({
                id: previous.id,
                content: previous.content,
                criterion: previous.criterion,
                status: previous.status,
              })),
            ...(input.origin
              ? {
                  origin: {
                    ...input.origin,
                    quote: IntelligenceEvaluation.evidence(input.origin.quote, { reference: input.origin.id, limit: 8000 }),
                  },
                }
              : {}),
            results: results.map((result) => ({
              ...result,
              input: IntelligenceEvaluation.evidence(result.input, { limit: 2000 }),
              summary: IntelligenceEvaluation.evidence(result.summary, { reference: result.callID, limit: 8000 }),
            })),
            coverage: {
              scope:
                "This task's source requirement, every subsequent user instruction, explicit scope change and cited proof are evaluated. Earlier unrelated history is excluded and is not proof of whole-session coverage.",
              excludedRequests: observed.requests.length - requests.length,
              excludedResults: observed.results.length - results.length,
            },
          },
          candidate,
          questions: {
            ...IntelligenceEvaluation.questions({
              coverage:
                "Does the candidate contradict a subsequent user correction, claim verification or completion that depends on missing or truncated source text, or imply coverage beyond the explicitly selected requirement? Truncated evidence is not proof of its omitted portion.",
              ...Object.fromEntries(
                candidate.flatMap((task, index) => [
                  [
                    `task_${index}_scope`,
                    `Does candidate[${index}] contradict its source requirement or introduce unrelated work?`,
                  ],
                  [
                    `task_${index}_criterion`,
                    `Does candidate[${index}] lack an observable acceptance criterion for its requirement?`,
                  ],
                  ...(task.status === "completed"
                    ? [
                        [
                          `task_${index}_evidence`,
                          `Is candidate[${index}] claimed complete without successful, relevant evidence in sources.results covering its entire criterion? A successful unrelated command is insufficient.`,
                        ],
                      ]
                    : []),
                ]),
              ),
            }),
            ...Object.fromEntries(
              candidate.map((_, index) => [
                `task_${index}_quality`,
                {
                  type: "score" as const,
                  instructions: `How clear, scoped and verifiable is candidate[${index}] as a task?`,
                  criteria: [
                    "Unclear, unscoped or unverifiable",
                    "Goal is visible but scope or acceptance is ambiguous",
                    "Clear scope and observable acceptance criterion",
                    "Precise, concise, traceable to its requirement and independently verifiable",
                  ],
                },
              ]),
            ),
          },
        })
        .pipe(Effect.mapError((error) => new SessionTodo.Error({ message: error.message })))
      return input.origin?.type === "plan" ? review.pipe(Effect.orElseSucceed(() => undefined)) : review
    })
    // Structural and revision checks above always apply; only the S1 verdict depends on the mode.
    // Task bookkeeping never stalls on S1: a refusal keeps the previous state, while an unavailable
    // evaluator or an inconclusive verdict applies the update with a visible unverified note. A plan
    // handoff carries the user's approval (or the Goal's execution consent), which S1 informs but
    // cannot overrule, so the tasks it admits only report the verdict.
    const notes = (yield* Effect.forEach(semantic, (record) =>
      input.origin?.type === "plan"
        ? Effect.succeed(IntelligenceEvaluation.approved(settings, record))
        : IntelligenceEvaluation.advise(settings, record),
    ).pipe(Effect.mapError((error) => new SessionTodo.Error({ message: error.message })))).filter(
      (note) => note !== undefined,
    )
    // New facts alone are no conflict; another committed task update or a broken proof is.
    const settle = Effect.fnUntraced(function* (current: ReadonlyArray<SessionTodo.Info>) {
      if (SessionTaskFacts.hash(current) !== SessionTaskFacts.hash(baseline))
        return yield* new SessionTodo.Error({
          message: "Tasks changed during this update; retry with current revisions",
        })
      if (!proven.size) return
      const fresh = yield* facts.load(input.sessionID)
      const broken = [...proven.values()]
        .flat()
        .map((proof) => recheck(fresh.results, proof, input.messageID))
        .find((error) => error !== undefined)
      if (broken) return yield* new SessionTodo.Error({ message: broken })
    })
    yield* settle(yield* get(input.sessionID))
    if (input.origin?.type !== "plan")
      yield* intelligence.read().pipe(
        Effect.flatMap(IntelligenceEvaluation.requireConfigured),
        Effect.mapError((error) => new SessionTodo.Error({ message: error.message })),
      )
    if (commit) yield* commit.before
    // Recheck the baseline inside the write transaction.
    return yield* db
      .transaction((tx) =>
        Effect.gen(function* () {
          const persisted = (yield* tx
            .select()
            .from(TodoTable)
            .where(eq(TodoTable.session_id, input.sessionID))
            .orderBy(asc(TodoTable.position))
            .all()
            .pipe(Effect.orDie)).map(read)
          yield* settle(persisted)
          yield* Effect.forEach(result, (task, position) =>
            Effect.gen(function* () {
              const before = previous.find((item) => item.id === task.id)
              for (const entry of before ? [before, task] : [task]) {
                yield* tx
                  .insert(TodoHistoryTable)
                  .values({
                    session_id: input.sessionID,
                    task_id: entry.id,
                    revision: entry.revision,
                    data: entry,
                    created: Date.now(),
                  })
                  .onConflictDoNothing()
                  .run()
                  .pipe(Effect.orDie)
              }
              yield* tx
                .insert(TodoTable)
                .values({
                  session_id: input.sessionID,
                  position,
                  task_id: task.id,
                  revision: task.revision,
                  content: task.content,
                  status: task.status,
                  priority: task.priority,
                  reason: task.reason ?? null,
                  legacy_status: task.legacyStatus ?? null,
                  details: {
                    source: task.source,
                    criterion: task.criterion,
                    evidence: task.evidence,
                    scopeChange: task.scopeChange,
                    closedAt: task.closedAt,
                  },
                })
                .onConflictDoUpdate({
                  target: [TodoTable.session_id, TodoTable.position],
                  set: {
                    task_id: task.id,
                    revision: task.revision,
                    content: task.content,
                    status: task.status,
                    priority: task.priority,
                    reason: task.reason ?? null,
                    legacy_status: task.legacyStatus ?? null,
                    details: {
                      source: task.source,
                      criterion: task.criterion,
                      evidence: task.evidence,
                      scopeChange: task.scopeChange,
                      closedAt: task.closedAt,
                    },
                  },
                })
                .run()
                .pipe(Effect.orDie)
            }),
          )
          if (commit) yield* commit.write
          return { todos: result, notes }
        }),
      )
      .pipe(Effect.catchTag("SqlError", Effect.die))
  })
  // A refusal reaches the model as a tool error and the person only as a folded row. The log keeps
  // its kind, the tasks it named and the first line of the reason, never prompts, commands or output.
  const write = (input: Parameters<typeof reconcile>[0], commit?: Commit) =>
    reconcile(input, commit).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("todowrite refused", {
          "session.id": input.sessionID,
          kind: refusalKind(error.message),
          tasks: input.todos.flatMap((item) => (item.id ? [item.id] : [])).join(","),
          error: firstLine(error.message, 80),
        }),
      ),
    )
  const update = (input: Parameters<typeof reconcile>[0], commit?: Commit) =>
    write(input, commit).pipe(Effect.map((written) => written.todos))

  const block = Effect.fn("SessionTodoStore.block")(function* (sessionID: SessionSchema.ID, reason: string) {
    return yield* update({
      sessionID,
      todos: (yield* get(sessionID))
        .filter((task) => task.status === "pending" || task.status === "in_progress")
        .map((task) => ({
          id: task.id,
          revision: task.revision,
          content: task.content,
          priority: Schema.is(SessionTodo.Priority)(task.priority) ? task.priority : "medium",
          status: "blocked",
          reason,
        })),
    })
  })
  const review = Effect.fn("SessionTodoStore.review")(function* (sessionID: SessionSchema.ID) {
    const current = yield* get(sessionID)
    if (!current.some((task) => task.status === "completed" && task.evidence)) return current
    const observed = yield* facts.load(sessionID)
    const stale = current.filter((task) => {
      if (task.status !== "completed" || !task.evidence) return false
      const proof = observed.results.find(
        (entry) => entry.callID === task.evidence?.callID && entry.messageID === task.evidence.messageID,
      )
      if (!proof?.successful || proof.hash !== task.evidence.hash) return true
      // Only a file edit after the proof, touching the proof's files when both are known, makes it
      // stale; verification commands, edits elsewhere and parts abandoned by a crashed turn leave the
      // completion standing. The same rule the completion itself was judged by.
      return invalidating(observed.results, proof) !== undefined
    })
    if (!stale.length) return current
    return yield* update({
      sessionID,
      todos: stale.map((task) => ({
        ...task,
        status: "pending",
        priority: Schema.is(SessionTodo.Priority)(task.priority) ? task.priority : "medium",
        reason: "Evidence changed or newer edits require verification",
      })),
    })
  })
  return { get, update, write, block, review, withMutation: lock.withPermits(1) }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/SessionTodoStore") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Database.node, SessionTaskFacts.node, Intelligence.node],
})
