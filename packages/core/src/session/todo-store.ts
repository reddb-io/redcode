export * as SessionTodoStore from "./todo-store"

import { createHash } from "node:crypto"
import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { SessionTodo } from "@reddb-io/redcode-schema/session-todo"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionSchema } from "./schema"
import { SessionTaskFacts } from "./task-facts"
import { TodoHistoryTable, TodoTable } from "./sql"

const make = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const facts = yield* SessionTaskFacts.Service
  // Both runtimes hold this lock through publication so an older list cannot arrive last.
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

  const update = Effect.fn("SessionTodoStore.update")(function* (input: {
    sessionID: SessionSchema.ID
    todos: ReadonlyArray<SessionTodo.Input>
    origin?: SessionTodo.Source
  }) {
    const incoming = yield* Schema.decodeUnknownEffect(Schema.Array(SessionTodo.Input))(input.todos).pipe(
      Effect.mapError((error) => new SessionTodo.Error({ message: `Invalid task update: ${error.message}` })),
    )
    if (!incoming.length) return yield* get(input.sessionID)
    const observed = yield* facts.load(input.sessionID)
    // Read, reconcile and write under the same DB transaction, including legacy callers.
    return yield* db
      .transaction((tx) =>
        Effect.gen(function* () {
          const previous = (yield* tx
            .select()
            .from(TodoTable)
            .where(eq(TodoTable.session_id, input.sessionID))
            .orderBy(asc(TodoTable.position))
            .all()
            .pipe(Effect.orDie)).map(read)
          const seen = new Set<string>()
          const changes = yield* Effect.forEach(incoming, (item) =>
            Effect.gen(function* () {
              const content = item.content.trim()
              if (!content) return yield* new SessionTodo.Error({ message: "Task content must not be empty" })
              const matches = previous.filter((task) =>
                item.id
                  ? task.id === item.id
                  : input.origin
                    ? task.source?.id === input.origin.id && task.source?.key === item.planKey
                    : task.content === content,
              )
              if (matches.length > 1)
                return yield* new SessionTodo.Error({
                  message: `Multiple tasks match ${content}; use the task id and revision`,
                })
              const before = matches[0]
              if (item.id && !before)
                return yield* new SessionTodo.Error({
                  message: `Unknown task ${item.id}; omit id when creating a task`,
                })
              if (item.id && item.revision === undefined)
                return yield* new SessionTodo.Error({ message: `Supply the current revision for task ${item.id}` })
              const key = before?.id ?? (input.origin?.type === "plan" ? (item.planKey ?? content) : content)
              if (seen.has(key)) return yield* new SessionTodo.Error({ message: `Duplicate task update: ${content}` })
              seen.add(key)
              if (input.origin?.type === "plan" && before) return before
              const reason = item.reason?.trim() || (before?.status === item.status ? before.reason : undefined)
              if ((item.status === "blocked" || item.status === "cancelled") && !reason)
                return yield* new SessionTodo.Error({
                  message: `${item.status} requires a concrete reason; do not discard remaining work`,
                })
              const request = observed.requests
                .toSorted((a, b) => b.created - a.created)
                .find((entry) => !item.requirement?.trim() || entry.text.includes(item.requirement.trim()))
              if (item.requirement && !input.origin && !before?.source && !request)
                return yield* new SessionTodo.Error({
                  message: "Task requirement must quote a real user message in this session",
                })
              const source =
                before?.source ??
                (input.origin
                  ? { ...input.origin, quote: item.requirement ?? input.origin.quote, key: item.planKey }
                  : undefined) ??
                (request
                  ? {
                      type: "request" as const,
                      id: request.id,
                      quote: item.requirement?.trim() || request.text,
                      created: request.created,
                    }
                  : undefined)
              if (
                source?.type === "request" &&
                !observed.requests.some((entry) => entry.id === source.id && entry.text.includes(source.quote))
              )
                return yield* new SessionTodo.Error({
                  message: "Task requirement must quote a real user message in this session",
                })
              const criterion = item.criterion?.trim() || before?.criterion || (source ? content : undefined)
              const unchangedClaim =
                before?.status === "completed" && before.content === content && before.criterion === criterion
              const claim = item.evidence ?? (unchangedClaim ? before?.evidence : undefined)
              const proofs = claim
                ? observed.results.filter(
                    (entry) =>
                      entry.callID === claim.callID && (!claim.messageID || entry.messageID === claim.messageID),
                  )
                : []
              const proof = proofs.length === 1 ? proofs[0] : undefined
              if (item.status === "completed" && source) {
                if (!claim?.explanation.trim() || !proof?.successful || proof.completed < source.created)
                  return yield* new SessionTodo.Error({
                    message:
                      "Completion requires evidence from a successful tool result in this session, after the request, with an explanation of the acceptance criterion. Use todowrite with an empty list to inspect available results and supply messageID to disambiguate reused callIDs.",
                  })
                if (
                  observed.results.some(
                    (entry) =>
                      entry.mutation &&
                      (entry.callID !== proof.callID || entry.messageID !== proof.messageID) &&
                      (!entry.settled || entry.completed >= proof.completed),
                  )
                )
                  return yield* new SessionTodo.Error({
                    message:
                      "Evidence predates a later edit or shell action. Verify the current result before completing this task.",
                  })
              }
              const scopeChange = item.scopeChange
                ? observed.requests.find(
                    (entry) =>
                      entry.id === item.scopeChange?.messageID &&
                      item.scopeChange.quote.trim() &&
                      entry.text.includes(item.scopeChange.quote),
                  )
                : undefined
              if (
                item.status === "cancelled" &&
                source &&
                before?.status !== "cancelled" &&
                (!scopeChange || scopeChange.created <= source.created)
              )
                return yield* new SessionTodo.Error({
                  message:
                    "Cancellation requires scopeChange quoting a later user instruction that removed this requirement",
                })
              return {
                id:
                  before?.id ??
                  (input.origin?.type === "plan"
                    ? `todo_${createHash("sha256")
                        .update(`${input.sessionID}:${input.origin.id}:${item.planKey ?? content}`)
                        .digest("hex")
                        .slice(0, 24)}`
                    : `todo_${crypto.randomUUID()}`),
                revision: before?.revision ?? 1,
                content,
                status: item.status,
                priority: item.priority,
                ...(source ? { source } : {}),
                ...(criterion ? { criterion } : {}),
                ...(item.status === "completed" && proof && claim
                  ? {
                      evidence: {
                        callID: proof.callID,
                        messageID: proof.messageID,
                        tool: proof.tool,
                        hash: proof.hash,
                        observed: proof.completed,
                        explanation: claim.explanation.trim(),
                      },
                    }
                  : {}),
                ...(scopeChange && item.scopeChange
                  ? {
                      scopeChange: {
                        messageID: scopeChange.id,
                        quote: item.scopeChange.quote,
                        created: scopeChange.created,
                      },
                    }
                  : before?.scopeChange
                    ? { scopeChange: before.scopeChange }
                    : {}),
                ...(reason ? { reason } : {}),
                ...(before?.legacyStatus ? { legacyStatus: before.legacyStatus } : {}),
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
            const status =
              task.id === current?.id ? "in_progress" : task.status === "in_progress" ? "pending" : task.status
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
              SessionTaskFacts.hash(before.scopeChange) === SessionTaskFacts.hash(task.scopeChange)
            return unchanged ? before : { ...task, status, revision: before ? before.revision + 1 : 1 }
          })
          // Compare against the reconciled state, including automatic promotion, for exact retries.
          yield* Effect.forEach(incoming, (item) =>
            Effect.gen(function* () {
              if (item.revision === undefined) return
              const before = previous.find((task) =>
                item.id ? task.id === item.id : task.content === item.content.trim(),
              )
              if (!before) return
              const after = result.find((task) => task.id === before.id)!
              if (item.revision !== before.revision && after.revision !== before.revision)
                return yield* new SessionTodo.Error({
                  message: `Task ${before.id} changed; read its current revision before updating`,
                })
            }),
          )
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
                    },
                  },
                })
                .run()
                .pipe(Effect.orDie)
            }),
          )
          return result
        }),
      )
      .pipe(Effect.catchTag("SqlError", Effect.die))
  })

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
      return (
        !proof?.successful ||
        proof.hash !== task.evidence.hash ||
        observed.results.some(
          (entry) =>
            entry.mutation &&
            (entry.callID !== task.evidence!.callID || entry.messageID !== task.evidence!.messageID) &&
            (!entry.settled || entry.completed >= task.evidence!.observed),
        )
      )
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
  return { get, update, block, review, withMutation: lock.withPermits(1) }
})

function read(row: typeof TodoTable.$inferSelect) {
  const known = Schema.is(SessionTodo.Status)(row.status)
  return {
    id:
      row.task_id ??
      `todo_${createHash("sha256").update(`${row.session_id}:${row.position}`).digest("hex").slice(0, 24)}`,
    ...row.details,
    revision: row.revision,
    content: row.content,
    status: known ? row.status : "blocked",
    priority: row.priority,
    ...(!known
      ? {
          legacyStatus: row.status,
          reason: `Historical status ${JSON.stringify(row.status)} needs reconciliation. Inspect the task and set its actual state.`,
        }
      : {
          ...(row.reason ? { reason: row.reason } : {}),
          ...(row.legacy_status ? { legacyStatus: row.legacy_status } : {}),
        }),
  }
}

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/SessionTodoStore") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Database.node, SessionTaskFacts.node],
})
