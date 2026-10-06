export * as SessionTodoEvidence from "./todo-evidence.js"

import { createHash } from "node:crypto"
import { SessionTodo } from "@opencode/schema/session-todo"
import { Schema } from "effect"
import { LOOP_GUARD_REFUSAL } from "./loop-marker.js"
import { TodoTable } from "./redcode.sql.js"
import { SessionTaskFacts } from "./task-facts.js"

export type Observed = {
  /** `pending`: admitted to the inbox but not shown to the model yet, so never a task's default source. */
  requests: ReadonlyArray<{ id: string; text: string; created: number; pending?: boolean }>
  results: ReadonlyArray<SessionTaskFacts.Result>
}

/** Prefix of every refusal the evidence engine issues; only these count toward blocking a task. */
export const REFUSED = "Completion evidence refused:"
/**
 * Prefix of a completion whose proof is acceptable but unexplained. Like a schema error, it is a
 * matter of resending the right shape, so it never counts toward blocking a task.
 */
export const NEEDS_EXPLANATION = "Completion evidence needs an explanation:"
/**
 * Prefix of a refusal older builds issued when a requirement quoted no user request. No longer issued:
 * a quote only links a source. Kept so refusals recorded before still classify.
 */
export const QUOTE_MISMATCH = "Task requirement does not match a user request:"
/** Prefix of a cancellation that names no user scope change at all. */
export const SCOPE_CHANGE_REQUIRED = "Cancellation requires a scope change:"

/**
 * Text as a quote is compared for linking: Unicode-normalised, case, quote marks, punctuation and
 * whitespace ignored. A miss only means the source is attached another way, never a refusal.
 */
const quoteForm = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()

/** Scripts written without spaces between words, where each character bounds a word. */
const DENSE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u
const DENSE_ALL = new RegExp(DENSE.source, "gu")

/**
 * A fragment too short to identify a request: under three words and twelve characters, counting each
 * character of a script written without spaces as a word.
 */
const trivial = (fragment: string) =>
  fragment.split(" ").length + (fragment.match(DENSE_ALL)?.length ?? 0) < 3 && fragment.length < 12

/** Where `fragment` occurs in `padded` from `at` as whole words; a dense-script edge needs no space. */
function wordAt(padded: string, fragment: string, at: number) {
  for (let found = padded.indexOf(fragment, at); found !== -1; found = padded.indexOf(fragment, found + 1)) {
    const start = padded[found - 1] === " " || DENSE.test(fragment[0]!)
    const end = padded[found + fragment.length] === " " || DENSE.test(fragment.at(-1)!)
    if (start && end) return found
  }
  return -1
}

/**
 * Whether `quote` quotes `text`. Retyping a request changes whitespace, quote marks, accents and
 * punctuation without changing what it says, so those are ignored; an ellipsis (`…` or `...`) stands
 * for omitted text, so its fragments must appear in order, as whole words. A fragment that could
 * match almost anything (`"e"`, `"ok"`) is not a quote unless it is the whole message.
 */
export function quotes(text: string, quote: string) {
  const body = quoteForm(text)
  const fragments = quote
    .split(/…|\.{3,}/)
    .map(quoteForm)
    .filter(Boolean)
  if (!fragments.length) return false
  if (fragments.length === 1 && fragments[0] === body) return true
  const padded = ` ${body} `
  let at = 0
  for (const fragment of fragments) {
    if (trivial(fragment)) return false
    const found = wordAt(padded, fragment, at)
    if (found === -1) return false
    at = found + fragment.length
  }
  return true
}

/** A stored status as the input type; `read` already maps historical values to blocked. */
export const storedStatus = (task: SessionTodo.Info): SessionTodo.Input["status"] & string =>
  Schema.is(SessionTodo.Status)(task.status) ? task.status : "blocked"

/** A short name for why a task update failed, for logs. */
export function refusalKind(message: string) {
  if (message.includes(LOOP_GUARD_REFUSAL)) return "loop-guard"
  if (message.includes(NEEDS_EXPLANATION)) return "needs-explanation"
  if (message.includes(REFUSED)) return "evidence-refused"
  if (message.includes(QUOTE_MISMATCH)) return "quote-mismatch"
  // The store's own decode, the legacy tool wrapper's and the v2 runner's, in that order.
  if (
    message.startsWith("Invalid task update") ||
    message.includes("was called with invalid arguments") ||
    message.startsWith("Invalid tool input")
  )
    return "schema"
  if (message.startsWith("Task content")) return "content"
  if (message.includes("its current revision is")) return "revision"
  if (message.startsWith("Unknown task")) return "unknown-task"
  if (message.startsWith("Multiple tasks match") || message.startsWith("Duplicate task update")) return "ambiguous"
  if (message.startsWith(SCOPE_CHANGE_REQUIRED)) return "scope-change"
  if (message.includes("requires a concrete reason") || message.startsWith("Cancellation requires")) return "reason"
  return "other"
}

export const firstLine = (text: string, limit: number) => {
  const line = text.split("\n")[0] ?? ""
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

/** Up to ten stored tasks, for an error that has to name the ids the model may use. */
export const listTasks = (tasks: ReadonlyArray<SessionTodo.Info>) =>
  tasks.length
    ? tasks
        .slice(0, 10)
        .map((task) => `${task.id} r${task.revision} "${task.content.slice(0, 60)}"`)
        .join(", ") + (tasks.length > 10 ? ` and ${tasks.length - 10} more` : "")
    : "none"

/** Text compared loosely: case, whitespace and punctuation do not make two sentences different. */
const loose = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()

/** A criterion that says something the task title does not, usable as the explanation of a check. */
export function explains(criterion: string | undefined, content: string) {
  const text = criterion?.trim()
  return text && loose(text) && loose(text) !== loose(content) ? text : undefined
}

/**
 * An edit that makes `proof` stale: a different call, touching the proof's files when both name
 * them, that either completed strictly after the proof or is still running in a message that has
 * not closed. The issuing message's own still-running siblings are not later edits yet, and a part
 * abandoned by a crashed turn is neither.
 */
export function invalidating(
  results: ReadonlyArray<SessionTaskFacts.Result>,
  proof: SessionTaskFacts.Result,
  messageID?: string,
) {
  // A design proof is about one design: a file edit inside another design's work directory leaves it standing.
  const design = proof.paths.length > 0 && proof.paths.every((entry) => entry.startsWith(SessionTaskFacts.DESIGN))
  return results
    .filter(
      (entry) =>
        entry.kind === "edit" &&
        !entry.abandoned &&
        (entry.callID !== proof.callID || entry.messageID !== proof.messageID) &&
        (entry.settled ? entry.completed > proof.completed : entry.messageID !== messageID) &&
        SessionTaskFacts.overlaps(design ? entry.paths.map(designScope) : entry.paths, proof.paths),
    )
    .toSorted((a, b) => b.completed - a.completed)[0]
}

/** A design's work directory, where Design edits its files: `.red/code/design/<id>/work/`. */
const WORK = /(?:^|\/)\.red\/code\/design\/(design_[A-Za-z0-9_-]+)\/work(?:\/|$)/

/** A file inside a design's work directory as the design it belongs to; any other path unchanged. */
const designScope = (entry: string) => {
  const match = WORK.exec(entry.replaceAll("\\", "/"))
  return match ? `${SessionTaskFacts.DESIGN}${match[1]}` : entry
}

/** The design a result works on: its design scope, or the design whose work directory it edited. */
const designOf = (entry: SessionTaskFacts.Result) =>
  entry.paths
    .map(designScope)
    .find((scope) => scope.startsWith(SessionTaskFacts.DESIGN))
    ?.slice(SessionTaskFacts.DESIGN.length)

/**
 * Evidence for a Design task. Design work edits after a preview as a matter of course, so a refusal
 * here is first answered with the newest successful design verification (`design_preview`,
 * `design_export`, `design_jobs`) that no later edit of its design made stale, and the result says
 * which one was attached. Only when none exists is the refusal kept, naming the exact next call.
 * Every other refusal and every non-Design task goes through {@link judge} unchanged.
 */
export function resolve(input: Parameters<typeof judge>[0] & { design?: boolean }):
  | {
      proof: SessionTaskFacts.Result
      proofs: ReadonlyArray<SessionTaskFacts.Result>
      explanation: string
      /** Which result was attached on the model's behalf, for the tool's response. */
      attached?: string
    }
  | { error: string } {
  const outcome = judge(input)
  if (!input.design) return outcome
  const describeProof = (proof: SessionTaskFacts.Result) =>
    `${proof.callID} (${proof.tool}, message ${proof.messageID}, ${iso(proof.completed)})`
  if ("proof" in outcome)
    return !input.claim && outcome.proof.tool.startsWith("design_")
      ? { ...outcome, attached: `Evidence attached automatically: ${describeProof(outcome.proof)}.` }
      : outcome
  if (!outcome.error.startsWith(REFUSED)) return outcome
  const fresh = input.observed.results
    .filter(
      (entry) =>
        entry.tool.startsWith("design_") &&
        entry.kind === "verification" &&
        entry.settled &&
        entry.successful &&
        !entry.abandoned &&
        entry.completed >= input.source.created &&
        !invalidating(input.observed.results, entry, input.messageID),
    )
    .toSorted((a, b) => b.completed - a.completed)[0]
  if (fresh)
    return {
      proof: fresh,
      proofs: [fresh],
      explanation:
        input.claim?.explanation?.trim() || input.fallback || `auto-attached latest design verification ${fresh.tool}`,
      attached: `Evidence attached automatically: ${describeProof(fresh)}, the newest design verification after the last edit of its design; the cited evidence was not usable: ${firstLine(outcome.error.slice(REFUSED.length).trim(), 200)}`,
    }
  const design = input.observed.results
    .filter((entry) => !entry.abandoned && designOf(entry))
    .toSorted((a, b) => b.completed - a.completed)
    .map(designOf)[0]
  return {
    error: `${REFUSED} Next step: call design_preview${design ? ` for ${design}` : ""} (or design_export for an export or a verify) after your last design edit, then resend this completion without evidence so the fresh result is attached automatically; this refusal does not block the task. ${outcome.error.slice(REFUSED.length).trim()}`,
  }
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
function judge(input: {
  observed: Observed
  /** The result the model cites, if it cites one. */
  claim: { callID: string; messageID?: string; explanation?: string } | undefined
  source: SessionTodo.Source
  content: string
  messageID?: string
  /** The task being completed, so an explanation request can quote the exact update to send. */
  task?: { id: string; revision: number }
  /** The reason sent with the completion; the only stand-in for a cited result's explanation. */
  reason?: string
  /** The reason or a criterion that says more than the title; explains a check picked automatically. */
  fallback?: string
}):
  | { proof: SessionTaskFacts.Result; proofs: ReadonlyArray<SessionTaskFacts.Result>; explanation: string }
  | { error: string } {
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
    return { proof, proofs: [proof], explanation }
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
    if (auto)
      return {
        proof: auto,
        proofs: [auto],
        explanation: input.fallback || `auto-selected latest verification ${auto.tool}`,
      }
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
    return (
      // Only an id no result carries at all is invented; one cited with the wrong message is not.
      (results.some((entry) => entry.callID === claim.callID)
        ? undefined
        : recover({ results, explanation, valid, callID: claim.callID, messageID: input.messageID })) ??
      refuse(
        `Evidence callID "${claim.callID}" does not match any tool result in this session. Cite a callID from the recent results, or run the verification and cite it. ${describe(results)}`,
      )
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

/**
 * Evidence for a cited callID that matches no result at all: a model that invented the id while
 * describing real work. The concrete artifacts its explanation names — files, design ids and
 * `commands` in backticks — are matched against the session's valid results by spelling alone, so the
 * explanation may be in any language. Each artifact is proved by its newest result that is not an
 * edit, as if it were cited: edits prove nothing, and a later overlapping edit refuses the completion.
 * `undefined` when nothing matches, so the caller keeps its refusal.
 */
function recover(input: {
  results: ReadonlyArray<SessionTaskFacts.Result>
  explanation: string
  valid: (entry: SessionTaskFacts.Result) => boolean
  callID: string
  messageID?: string
}) {
  const candidates = input.results
    .filter((entry) => input.valid(entry) && entry.kind !== "edit")
    .toSorted((a, b) => b.completed - a.completed)
  const files = [
    ...new Set(candidates.flatMap((entry) => entry.paths.filter((file) => mentions(input.explanation, file)))),
  ]
  const ids = [...new Set(input.explanation.match(IDENTIFIER) ?? [])]
  const commands = [...input.explanation.matchAll(/`([^`\n]{3,})`/g)].map((match) => match[1]!.trim())
  const proofs = [
    ...new Map(
      [
        ...files.map((file) => candidates.find((entry) => entry.paths.includes(file))),
        // A design tool working on the design proves it before one that only reports its id, such as a listing.
        ...ids.map((id) => {
          const design = candidates.filter((entry) => entry.tool.startsWith("design_"))
          return (
            design.find((entry) => entry.paths.includes(`${SessionTaskFacts.DESIGN}${id}`)) ??
            design.find((entry) => entry.summary.includes(id))
          )
        }),
        ...commands.map((text) =>
          candidates.find(
            (entry) =>
              (entry.tool === "bash" || entry.tool === "shell") &&
              (SessionTaskFacts.command(entry.input, Infinity)?.includes(text) ?? false),
          ),
        ),
      ].flatMap((proof) => (proof ? [[`${proof.messageID}:${proof.callID}`, proof] as const] : [])),
    ).values(),
  ].toSorted((a, b) => b.completed - a.completed)
  if (!proofs.length) return undefined
  const stale = proofs.flatMap((proof) => {
    const edit = invalidating(input.results, proof, input.messageID)
    return edit ? [predates(proof, edit)] : []
  })[0]
  if (stale)
    return {
      error: `${REFUSED} Evidence callID "${input.callID}" matches no tool result, and the result its explanation names is stale. ${stale}`,
    }
  // The newest one is stored as the task's evidence; the explanation keeps every result it rests on.
  return {
    proof: proofs[0]!,
    proofs,
    explanation: `${input.explanation} [${RESOLVED} ${proofs.map((proof) => `${proof.callID} (${proof.tool}, message ${proof.messageID})`).join(", ")}]`,
  }
}

/** Marks an explanation whose evidence was resolved from the artifacts it names, not from its cited callID. */
export const RESOLVED = "evidence resolved from explanation:"

/** An id another tool reported, such as a design's `design_1d2e…`: a prefix, then at least 8 characters with a digit. */
const IDENTIFIER = /\b[a-z]+_(?=[0-9a-z-]*\d)[0-9a-z-]{8,}/gi

/**
 * Whether `text` names `file`: the whole path or a trailing part of it that starts at a segment and
 * keeps a separator or an extension (`voice.md`, `identity/voice.md`), with no path character
 * continuing it on either side. Only ASCII path characters bound a mention, so it is found inside a
 * sentence in any language or script.
 */
function mentions(text: string, file: string) {
  if (file.startsWith(SessionTaskFacts.DESIGN)) return false
  // Windows paths are compared case-insensitively, as the task facts store them.
  const windows = /^[a-z]:/i.test(file)
  const body = windows ? text.replaceAll("\\", "/").toLowerCase() : text.replaceAll("\\", "/")
  const segments = (windows ? file.toLowerCase() : file).split("/")
  return segments.some((_, index) => {
    const suffix = segments.slice(index).join("/")
    if (!/[./]/.test(suffix.replace(/^\//, ""))) return false
    for (let at = body.indexOf(suffix); at !== -1; at = body.indexOf(suffix, at + 1)) {
      const before = body.slice(0, at).replace(/(\.\.?\/)+$/, "")
      const after = body.slice(at + suffix.length)
      if (!/[A-Za-z0-9_\-./~]$/.test(before) && !/^([A-Za-z0-9_\-/~]|\.[A-Za-z0-9])/.test(after)) return true
    }
    return false
  })
}

/**
 * Why `proof`, accepted before S1 evaluated the update, no longer holds against the facts that
 * landed meanwhile: its result changed or vanished, or a later edit overlapping its files settled.
 */
export function recheck(results: ReadonlyArray<SessionTaskFacts.Result>, proof: SessionTaskFacts.Result, messageID?: string) {
  const current = results.find((entry) => entry.callID === proof.callID && entry.messageID === proof.messageID)
  if (!current || current.hash !== proof.hash || !current.successful || current.abandoned)
    return `${REFUSED} Evidence callID "${proof.callID}" (${proof.tool}) changed while the update was evaluated. Run the check again and cite the new result.`
  const edit = invalidating(results, current, messageID)
  return edit ? `${REFUSED} ${predates(current, edit)}` : undefined
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
export function failedAttempts(results: ReadonlyArray<SessionTaskFacts.Result>, task: SessionTodo.Info, since: number) {
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

export function read(row: typeof TodoTable.$inferSelect) {
  const known = Schema.is(SessionTodo.Status)(row.status)
  return {
    id:
      row.task_id ??
      `todo_${createHash("sha256").update(`${row.session_id}:${row.position}`).digest("hex").slice(0, 24)}`,
    ...(row.details ?? {}),
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
