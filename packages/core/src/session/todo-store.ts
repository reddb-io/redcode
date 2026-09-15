export * as SessionTodoStore from "./todo-store"

import { createHash } from "node:crypto"
import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { SessionTodo } from "@reddb-io/redcode-schema/session-todo"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { LOOP_GUARD_REFUSAL } from "./loop-marker"
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

  const update = Effect.fn("SessionTodoStore.update")(
    function* (input: {
      sessionID: SessionSchema.ID
      todos: ReadonlyArray<SessionTodo.Input>
      origin?: SessionTodo.Source
      /** The assistant message issuing this update; its still-running sibling tools are not held against it. */
      messageID?: string
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
                    message: `Unknown task ${item.id}; omit id when creating a task. Existing tasks: ${previous.length ? previous.map((task) => `${task.id} r${task.revision} "${task.content.slice(0, 60)}"`).join(", ") : "none"}`,
                  })
                if (item.id && item.revision === undefined)
                  return yield* new SessionTodo.Error({
                    message: `Supply the current revision for task ${item.id}, e.g. {"todos":[{"id":"${item.id}","revision":${before!.revision},"status":"${item.status}"}]}`,
                  })
                if (!before && !supplied)
                  return yield* new SessionTodo.Error({
                    message:
                      "Task content is required to create a task; supply id and revision to update an existing one",
                  })
                const content = supplied ?? before!.content
                const priority =
                  item.priority ??
                  (before && Schema.is(SessionTodo.Priority)(before.priority) ? before.priority : "medium")
                const key = before?.id ?? (input.origin?.type === "plan" ? (item.planKey ?? content) : content)
                if (seen.has(key)) return yield* new SessionTodo.Error({ message: `Duplicate task update: ${content}` })
                seen.add(key)
                if (input.origin?.type === "plan" && before) return before
                const reason = item.reason?.trim() || (before?.status === item.status ? before.reason : undefined)
                if ((item.status === "blocked" || item.status === "cancelled") && !reason)
                  return yield* new SessionTodo.Error({
                    message: `${item.status} requires a concrete reason; do not discard remaining work`,
                  })
                const requirement = item.requirement?.trim()
                const requests = observed.requests.toSorted((a, b) => b.created - a.created)
                const quoted = requests.find((entry) => !requirement || quotes(entry.text, requirement))
                // A requirement that paraphrases, translates or retypes the request still names work the
                // user asked for. The latest real request becomes the source, verbatim, and the model's
                // wording is kept as the criterion; the completion gate is unchanged, since it hangs on
                // the source.
                const paraphrased = requirement && !quoted ? requests[0] : undefined
                const request = quoted ?? paraphrased
                if (requirement && !input.origin && !before?.source && !request)
                  return yield* new SessionTodo.Error({
                    message: `${QUOTE_MISMATCH} no user message is recorded in this session to quote yet. Create the task without requirement, e.g. {"todos":[{"content":"${content.replaceAll('"', "'").slice(0, 60)}","status":"pending","priority":"high","criterion":"<observable result>"}]}`,
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
                        quote: quoted && requirement ? requirement : request.text,
                        created: request.created,
                      }
                    : undefined)
                // Only a source this update supplies is checked against the history. A stored one was checked
                // when the task was created, and its request may since have left the history (compaction).
                if (
                  !before?.source &&
                  source?.type === "request" &&
                  !observed.requests.some((entry) => entry.id === source.id && quotes(entry.text, source.quote))
                )
                  return yield* new SessionTodo.Error({
                    message: `${QUOTE_MISMATCH} the source request ${source.id} no longer contains the quote. Omit requirement; the latest request is attached for you.`,
                  })
                const criterion =
                  item.criterion?.trim() ||
                  before?.criterion ||
                  (paraphrased && !before?.source ? requirement : undefined) ||
                  (source ? content : undefined)
                // A task that is already complete keeps its stored evidence when re-sent without new
                // evidence; review() is what reopens it when later edits made that evidence stale.
                const kept = before?.status === "completed" && !item.evidence ? before.evidence : undefined
                const resolved =
                  item.status === "completed" && source && !kept
                    ? resolve({
                        observed,
                        claim: item.evidence,
                        source,
                        content,
                        messageID: input.messageID,
                        task: before ? { id: before.id, revision: before.revision } : undefined,
                        reason: item.reason?.trim() || undefined,
                        // A criterion that only restates the task explains nothing about a check.
                        fallback:
                          item.reason?.trim() ||
                          explains(item.criterion, content) ||
                          explains(before?.criterion, content),
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
                const scopeChange = item.scopeChange
                  ? observed.requests.find(
                      (entry) =>
                        entry.id === item.scopeChange?.messageID &&
                        item.scopeChange.quote.trim() &&
                        quotes(entry.text, item.scopeChange.quote),
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
                  status: capped ? ("blocked" as const) : item.status,
                  priority,
                  ...(source ? { source } : {}),
                  ...(criterion ? { criterion } : {}),
                  ...(item.status === "completed" && kept ? { evidence: kept } : {}),
                  ...(item.status === "completed" && proof
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
                  ...(capped ? { reason: capped } : reason ? { reason } : {}),
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
                  item.id ? task.id === item.id : task.content === item.content?.trim(),
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
    },
    (effect, input) =>
      effect.pipe(
        // A refusal reaches the model as a tool error and the person only as a folded row; the log
        // keeps why, without the prompt text.
        Effect.tapError((error) =>
          Effect.logWarning("todowrite refused", {
            "session.id": input.sessionID,
            kind: refusalKind(error.message),
            error: error.message,
          }),
        ),
      ),
  )

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
  return { get, update, block, review, withMutation: lock.withPermits(1) }
})

type Observed = {
  requests: ReadonlyArray<{ id: string; text: string; created: number }>
  results: ReadonlyArray<SessionTaskFacts.Result>
}

/** Prefix of every refusal the evidence engine issues; only these count toward blocking a task. */
export const REFUSED = "Completion evidence refused:"
/**
 * Prefix of a completion whose proof is acceptable but unexplained. Like a schema error, it is a
 * matter of resending the right shape, so it never counts toward blocking a task.
 */
export const NEEDS_EXPLANATION = "Completion evidence needs an explanation:"
/** Prefix of a requirement that cannot be tied to any user request. */
export const QUOTE_MISMATCH = "Task requirement does not match a user request:"

/** Text as a quote is compared: composed accents, case, quote marks, punctuation and whitespace ignored. */
const quoteForm = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()

/**
 * Whether `quote` quotes `text`. Retyping a request changes whitespace, quote marks, accents and
 * punctuation without changing what it says, so those are ignored; an ellipsis (`…` or `...`) stands
 * for omitted text, so its fragments must appear in order.
 */
export function quotes(text: string, quote: string) {
  const body = quoteForm(text)
  const fragments = quote
    .split(/…|\.{3,}/)
    .map(quoteForm)
    .filter(Boolean)
  if (!fragments.length) return false
  let at = 0
  for (const fragment of fragments) {
    const found = body.indexOf(fragment, at)
    if (found === -1) return false
    at = found + fragment.length
  }
  return true
}

/** A short name for why a task update failed, for logs. */
export function refusalKind(message: string) {
  if (message.includes(LOOP_GUARD_REFUSAL)) return "loop-guard"
  if (message.includes(NEEDS_EXPLANATION)) return "needs-explanation"
  if (message.includes(REFUSED)) return "evidence-refused"
  if (message.includes(QUOTE_MISMATCH)) return "quote-mismatch"
  if (message.startsWith("Invalid task update")) return "schema"
  if (message.includes("revision")) return "revision"
  if (message.startsWith("Unknown task")) return "unknown-task"
  if (message.startsWith("Multiple tasks match") || message.startsWith("Duplicate task update")) return "ambiguous"
  if (message.includes("requires a concrete reason") || message.startsWith("Cancellation requires")) return "reason"
  return "other"
}

/** Text compared loosely: case, whitespace and punctuation do not make two sentences different. */
const loose = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()

/** A criterion that says something the task title does not, usable as the explanation of a check. */
function explains(criterion: string | undefined, content: string) {
  const text = criterion?.trim()
  return text && loose(text) && loose(text) !== loose(content) ? text : undefined
}

/**
 * An edit that makes `proof` stale: a different call, touching the proof's files when both name
 * them, that either completed strictly after the proof or is still running in a message that has
 * not closed. The issuing message's own still-running siblings are not later edits yet, and a part
 * abandoned by a crashed turn is neither.
 */
function invalidating(
  results: ReadonlyArray<SessionTaskFacts.Result>,
  proof: SessionTaskFacts.Result,
  messageID?: string,
) {
  return results
    .filter(
      (entry) =>
        entry.kind === "edit" &&
        !entry.abandoned &&
        (entry.callID !== proof.callID || entry.messageID !== proof.messageID) &&
        (entry.settled ? entry.completed > proof.completed : entry.messageID !== messageID) &&
        SessionTaskFacts.overlaps(entry.paths, proof.paths),
    )
    .toSorted((a, b) => b.completed - a.completed)[0]
}

/**
 * Pick the tool result that proves a completion.
 *
 * A cited callID is judged on its own: it must name one settled, successful, non-bookkeeping result
 * after the request that is not an edit and that no later edit has made stale; otherwise the
 * specific refusal comes back and no other result is substituted. A read, grep or other result may
 * be cited for investigation work. Only when nothing is cited does the engine select on the model's
 * behalf, and then only a verification result (a successful shell check, a design preview or
 * export) that is newer than every edit overlapping it. Refusals list the candidates inline.
 */
function resolve(input: {
  observed: Observed
  claim: SessionTodo.Input["evidence"]
  source: SessionTodo.Source
  content: string
  messageID?: string
  /** The task being completed, so an explanation request can quote the exact update to send. */
  task?: { id: string; revision: number }
  /** The reason sent with the completion; the only stand-in for a cited result's explanation. */
  reason?: string
  /** The reason or a criterion that says more than the title; explains a check picked automatically. */
  fallback?: string
}): { proof: SessionTaskFacts.Result; explanation: string } | { error: string } {
  const results = input.observed.results
  const claim = input.claim
  const when = `the request ${input.source.id} at ${iso(input.source.created)}`
  const refuse = (text: string) => ({ error: `${REFUSED} ${text}` })
  const unexplained = (proof: SessionTaskFacts.Result) => {
    const shell = proof.tool === "bash" || proof.tool === "shell" ? SessionTaskFacts.command(proof.input) : undefined
    const update = {
      todos: [
        {
          id: input.task?.id ?? "<task id>",
          revision: input.task?.revision ?? "<current revision>",
          status: "completed",
          evidence: {
            callID: proof.callID,
            messageID: proof.messageID,
            explanation: "<how this result meets the task>",
          },
        },
      ],
    }
    return {
      error: `${NEEDS_EXPLANATION} ${proof.callID} (${proof.tool}${shell ? `: ${shell}` : ""}) can prove "${input.content}", but the completion needs an explanation of how it meets the task. Resend exactly: ${JSON.stringify(update)}. A reason on the task (\"reason\":\"<how it verifies the task>\") works as the explanation too. This does not count as a failed attempt.`,
    }
  }
  const valid = (entry: SessionTaskFacts.Result) =>
    entry.settled &&
    entry.successful &&
    !entry.abandoned &&
    entry.kind !== "bookkeeping" &&
    entry.completed >= input.source.created
  const accept = (proof: SessionTaskFacts.Result, explanation: string) => {
    const edit = invalidating(results, proof, input.messageID)
    if (edit) return refuse(predates(proof, edit))
    return { proof, explanation }
  }
  if (!claim) {
    const shell = (entry: SessionTaskFacts.Result) => entry.tool === "bash" || entry.tool === "shell"
    const candidates = results
      .filter(
        (entry) => valid(entry) && entry.kind === "verification" && !invalidating(results, entry, input.messageID),
      )
      .toSorted((a, b) => b.completed - a.completed)
    // A command that only looks at things (`ls`, `cat`, `git status`) exits 0 without proving anything,
    // so it is never picked; a real check among the candidates still is.
    const auto = candidates.find((entry) => !shell(entry) || !SessionTaskFacts.readOnly(entry.input))
    const inspection = candidates.find((entry) => shell(entry) && SessionTaskFacts.readOnly(entry.input))
    if (!auto && inspection)
      return refuse(
        `Completing "${input.content}" has no verification to record: the only command after the last edit, ${inspection.callID} (${inspection.tool}: ${SessionTaskFacts.command(inspection.input)}), only inspects and proves nothing by exiting 0. Run the check that proves the task, then cite the verifying command as evidence with an explanation: {"callID":"<its callID>","explanation":"<how its output meets the task>"}; for investigation work, cite the result that answers it. ${describe(results)}`,
      )
    // A shell pick is recorded only when the task says what it had to show; a render or export is its
    // own explanation.
    if (auto && shell(auto) && !input.fallback) return unexplained(auto)
    if (auto) return { proof: auto, explanation: input.fallback || `auto-selected latest verification ${auto.tool}` }
    return refuse(
      `Completing "${input.content}" needs evidence, and no verification result (a successful bash or shell check, design_preview or design_export) exists after ${when} and after the last edit. Run the check that proves the task, then complete it; or, for investigation work, cite the read, grep or other result that answers it as evidence with an explanation. ${describe(results)}`,
    )
  }
  const matching = results.filter(
    (entry) => entry.callID === claim.callID && (!claim.messageID || entry.messageID === claim.messageID),
  )
  // A reused provider callID is still the cited call when exactly one of its matches qualifies.
  const explicit =
    matching.length === 1 ? matching[0] : matching.filter(valid).length === 1 ? matching.find(valid) : undefined
  // A cited result is the model's own claim, so the model must say how it meets the criterion.
  const explanation = claim.explanation?.trim() || input.reason || ""
  if (!matching.length)
    return refuse(
      `Evidence callID "${claim.callID}" does not match any tool result in this session. Cite a callID from the recent results, or run the verification and cite it. ${describe(results)}`,
    )
  if (!explicit)
    return refuse(
      `Evidence callID "${claim.callID}" matches ${matching.length} results (messages ${matching.map((entry) => entry.messageID).join(", ")}); supply evidence.messageID to disambiguate. ${describe(results)}`,
    )
  if (explicit.abandoned || !explicit.settled)
    return refuse(
      `Evidence callID "${claim.callID}" (${explicit.tool}) ${explicit.abandoned ? "never finished; its turn ended first" : "has not finished yet"}. Wait for a settled result or run the check again. ${describe(results)}`,
    )
  if (!explicit.successful)
    return refuse(
      `Evidence callID "${claim.callID}" (${explicit.tool}) is a failed result${explicit.error ? ` (${explicit.error.slice(0, 200)})` : ""}. A failed check proves nothing: fix the cause, run the check again, and cite the passing result. ${describe(results)}`,
    )
  if (explicit.kind === "bookkeeping")
    return refuse(
      `Evidence callID "${claim.callID}" (${explicit.tool}) is task bookkeeping, not a result of the work. ${describe(results)}`,
    )
  if (explicit.completed < input.source.created)
    return refuse(
      `Evidence callID "${claim.callID}" (${explicit.tool}) completed at ${iso(explicit.completed)}, before ${when}. Run the verification again and cite the new result. ${describe(results, 1)}`,
    )
  if (explicit.kind === "edit")
    return refuse(
      `Evidence callID "${claim.callID}" (${explicit.tool}) is the edit itself, which shows a change was made but not that it works. Run a check after the last edit (tests, build, a command that exercises it, design_preview) and cite that result. ${describe(results)}`,
    )
  if (!explanation) return unexplained(explicit)
  return accept(explicit, explanation)
}

function predates(proof: SessionTaskFacts.Result, edit: SessionTaskFacts.Result) {
  const files = edit.paths.length ? `, ${edit.paths.join(", ")}` : ""
  const when = edit.settled ? iso(edit.completed) : "still running"
  return `Evidence callID "${proof.callID}" (${proof.tool}, ${iso(proof.completed)}) predates a later edit ${edit.callID} (${edit.tool}${files}, ${when}). Re-run the verification after the last edit, then complete the task citing the new result.`
}

function describe(results: ReadonlyArray<SessionTaskFacts.Result>, limit = 5) {
  const recent = results
    .filter((entry) => entry.kind !== "bookkeeping")
    .toSorted((a, b) => b.completed - a.completed)
    .slice(0, limit)
  if (!recent.length) return "Recent results: none."
  const state = (entry: SessionTaskFacts.Result) =>
    entry.abandoned ? "abandoned" : entry.successful ? "succeeded" : entry.settled ? "failed" : "unsettled"
  return `Recent results (newest first): ${recent
    .map(
      (entry) =>
        `${entry.callID} (${entry.tool}, ${entry.kind}, message ${entry.messageID}, ${state(entry)} at ${iso(entry.completed)})`,
    )
    .join("; ")}.`
}

/**
 * Evidence refusals already issued in this turn for completing this task, back to the last
 * successful todowrite. Only the engine's own refusals count: a malformed call, a stale revision or
 * a loop-guard correction is a different problem and neither counts nor resets the run.
 */
function failedAttempts(results: ReadonlyArray<SessionTaskFacts.Result>, task: SessionTodo.Info, since: number) {
  const targets = (input: unknown) => {
    const todos = typeof input === "object" && input !== null ? (input as { todos?: unknown }).todos : undefined
    return (
      Array.isArray(todos) &&
      todos.some(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          (item as { status?: unknown }).status === "completed" &&
          ((item as { id?: unknown }).id === task.id || (item as { content?: unknown }).content === task.content),
      )
    )
  }
  const attempts = results
    .filter((entry) => entry.tool === "todowrite" && entry.settled && !entry.abandoned && entry.completed >= since)
    .toSorted((a, b) => b.completed - a.completed)
  const success = attempts.findIndex((entry) => !entry.errored)
  return attempts
    .slice(0, success === -1 ? attempts.length : success)
    .filter((entry) => refusal(entry.error) && targets(entry.input)).length
}

/** An engine refusal, possibly wrapped by the runtime's error formatting, but never a guard's quote of one. */
const refusal = (error: string) => {
  const at = error.indexOf(REFUSED)
  return at !== -1 && !error.slice(0, at).includes(LOOP_GUARD_REFUSAL)
}

const iso = (millis: number) => new Date(millis).toISOString()

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
