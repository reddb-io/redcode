/**
 * Supervising a subagent from its parent: the brief it is launched with, the checkpoints on its way,
 * and the result it hands back.
 *
 * Kept pure and runtime-agnostic, like the loop guard and the stall detector: the legacy task tool
 * and the V2 subagent tool supply the observations and ask S1 the semantic questions; this module
 * holds the structural checks every reasoning mode runs, the S1 question set, and the wording the
 * parent model reads. Structural checks look only at structured fields, never at the words of the
 * prompt, so they behave the same in every language.
 */

import { minimatch } from "minimatch"
import { Intelligence } from "../intelligence"
import { SessionTaskFacts } from "./task-facts"

/** How the brief a subagent runs under was judged before it started. */
export type Verdict = "verified" | "inconclusive" | "needs_revision" | "unverified" | "skipped"

/** The accepted brief, kept in the child session's metadata for the checkpoints and the result review. */
export interface Brief {
  readonly brief: string
  readonly agent: string
  readonly scope: ReadonlyArray<string>
  readonly criteria: ReadonlyArray<string>
  readonly returnFormat?: string
  /** Whether the subagent may change files or run commands; read-only subagents skip checkpoints. */
  readonly writeCapable: boolean
  readonly parentSessionID: string
  readonly callID?: string
  readonly briefEvaluationID?: string
  readonly verdict: Verdict
  readonly issues: ReadonlyArray<string>
  readonly created: number
  /** How the parent judged the latest result the subagent handed back under this brief. */
  readonly result?: ResultReview
}

export const METADATA_KEY = "subagentBrief"

export function fromMetadata(metadata: Record<string, unknown> | undefined): Brief | undefined {
  const raw = metadata?.[METADATA_KEY]
  if (!raw || typeof raw !== "object") return undefined
  const brief = raw as Partial<Brief>
  if (typeof brief.brief !== "string" || typeof brief.agent !== "string" || typeof brief.verdict !== "string")
    return undefined
  return {
    ...(brief as Brief),
    scope: strings(brief.scope),
    criteria: strings(brief.criteria),
    issues: strings(brief.issues),
    writeCapable: brief.writeCapable === true,
    result: resultOf(brief.result),
  }
}

function resultOf(value: unknown): ResultReview | undefined {
  if (!value || typeof value !== "object") return undefined
  const result = value as Partial<ResultReview>
  if (!RESULT_DECISIONS.includes(result.decision as ResultDecision)) return undefined
  return { ...(result as ResultReview), issues: strings(result.issues), repaired: result.repaired === true }
}

/**
 * Whether the parent reviews this subagent's result against its brief: the parent wrote the brief
 * and gave it structure to check against. Such a child skips its own generic response review.
 */
export function supervised(brief: Brief | undefined): brief is Brief {
  return (
    !!brief &&
    brief.verdict !== "skipped" &&
    (brief.scope.length > 0 || brief.criteria.length > 0 || !!brief.returnFormat?.trim())
  )
}

export function toMetadata(metadata: Record<string, unknown> | undefined, brief: Brief): Record<string, unknown> {
  return { ...metadata, [METADATA_KEY]: brief }
}

/**
 * The structured half of a brief as the subagent reads it, after the prompt. Nothing when the parent
 * passed no scope, criteria or return format.
 */
export function instructions(input: {
  readonly scope?: ReadonlyArray<string>
  readonly criteria?: ReadonlyArray<string>
  readonly returnFormat?: string
}) {
  const scope = strings(input.scope)
  const criteria = strings(input.criteria)
  const format = input.returnFormat?.trim()
  if (!scope.length && !criteria.length && !format) return undefined
  return [
    "<brief>",
    ...(scope.length
      ? [
          "Scope: change only files matching these globs, and read outside them only for context.",
          ...scope.map((glob) => `- ${glob}`),
        ]
      : []),
    ...(criteria.length
      ? [
          "Done criteria: finish only when each holds, and report the evidence for each.",
          ...criteria.map((item) => `- ${item}`),
        ]
      : []),
    ...(format ? [`Return format: ${format}`] : []),
    "</brief>",
  ].join("\n")
}

export interface Finding<ID extends string = string> {
  readonly id: ID
  /** Whether the finding alone stops the work; the others are advice S1 or the parent weighs. */
  readonly blocking: boolean
  readonly message: string
}

export type BriefIssue =
  | "empty_prompt"
  | "short_prompt"
  | "missing_done_criteria"
  | "missing_return_format"
  | "missing_scope"

export interface BriefInput {
  readonly prompt: string
  readonly scope?: ReadonlyArray<string>
  readonly doneCriteria?: ReadonlyArray<string>
  readonly returnFormat?: string
  /** The subagent may edit files or run commands, so it needs a boundary. */
  readonly writeCapable: boolean
}

/** Code points, not bytes or words: a short brief is short in every script. */
export const MIN_PROMPT = 40

const BRIEF_MESSAGES: Record<BriefIssue, string> = {
  empty_prompt: "The prompt is empty; the subagent starts with a blank context and would have nothing to do.",
  short_prompt: `The prompt is under ${MIN_PROMPT} characters; the subagent starts with a blank context and needs the objective, context and constraints spelled out.`,
  missing_done_criteria: "No done_criteria: nothing says when the subagent is finished or how its result is checked.",
  missing_return_format: "No return_format: nothing says what the subagent must hand back.",
  missing_scope: "No scope for a subagent that can change files or run commands: nothing bounds where it may work.",
}

/** What the brief's structured fields leave out. Only an empty prompt blocks on its own. */
export function briefStructure(input: BriefInput): Finding<BriefIssue>[] {
  const prompt = input.prompt.trim()
  if (!prompt) return [briefFinding("empty_prompt", true)]
  return [
    ...([...prompt].length < MIN_PROMPT ? [briefFinding("short_prompt")] : []),
    ...(strings(input.doneCriteria).length ? [] : [briefFinding("missing_done_criteria")]),
    ...(input.returnFormat?.trim() ? [] : [briefFinding("missing_return_format")]),
    ...(input.writeCapable && !strings(input.scope).length ? [briefFinding("missing_scope")] : []),
  ]
}

const briefFinding = (id: BriefIssue, blocking = false): Finding<BriefIssue> => ({
  id,
  blocking,
  message: BRIEF_MESSAGES[id],
})

/**
 * What S1 is asked about a brief. A yes to any question is an error in the brief; the answers are
 * the issue ids {@link revision} turns into questions for the parent.
 */
export const briefQuestions = Intelligence.questions({
  missing_done_criteria:
    "Does candidate lack done criteria a reviewer could check the subagent's result against (candidate.done_criteria absent, vague, or not observable, and candidate.prompt states none either)?",
  missing_scope:
    "When sources.agent.write_capable is true, does candidate fail to bound where the subagent may work (candidate.scope absent and candidate.prompt names no files, directories, systems or non-goals)? Answer no when the agent is read-only.",
  missing_context:
    "Does candidate.prompt omit context the subagent needs and cannot discover on its own, such as file paths, identifiers, prior findings or decisions from sources.requests? The subagent starts with a blank context and sees only candidate.",
  misaligned_with_request:
    "Does candidate ask for work that contradicts or diverges from the user's request in sources.requests, sources.goal or sources.plan, accounting for later corrections?",
  overreach:
    "Does candidate ask the subagent to do more than sources.requests authorize, or to act where sources.agent.permissions deny it, such as publishing, deleting, or changing files the request did not cover?",
  unspecified_output:
    "Does candidate fail to say what the subagent must hand back (candidate.return_format absent and candidate.prompt specifies neither the content nor the shape of the final answer)?",
})

const REVISION: Record<string, string> = {
  empty_prompt: "What is the subagent's objective? Write it in the prompt.",
  short_prompt:
    "What does the subagent need to know to work alone? Expand the prompt with the objective, context and constraints.",
  missing_done_criteria: "What observable result tells the subagent it is done? Pass it in done_criteria.",
  missing_scope:
    "Which files, directories or systems may the subagent touch, and what is out of bounds? Pass globs in scope and name the non-goals in the prompt.",
  missing_return_format: "What must the subagent hand back, and in what shape? Pass it in return_format.",
  unspecified_output: "What must the subagent hand back, and in what shape? Pass it in return_format.",
  missing_context:
    "Which paths, identifiers, findings or decisions from this conversation does the subagent need? Put them in the prompt; it starts with a blank context.",
  misaligned_with_request:
    "How does this task serve what the user asked? Rewrite it against the user's latest request.",
  overreach:
    "Which part of this task goes beyond what the user asked or what the agent may do? Drop it, or ask the user first.",
}

/** The questions the parent answers in a revised brief, one per issue, without repeats. */
export function revision(issues: ReadonlyArray<string>) {
  return [...new Set(issues.map((issue) => REVISION[issue.replace(/^\d+:/, "")]).filter((item) => item !== undefined))]
}

/** A brief review's outcome, as the tool reports it and the child's metadata keeps it. */
export interface Review {
  readonly verdict: Verdict
  readonly issues: ReadonlyArray<string>
  readonly evaluationID?: string
  /** Why S1 gave no verdict, when it could not be reached. */
  readonly unavailable?: string
  /** Structural findings, the only check single reasoning runs. */
  readonly findings?: ReadonlyArray<Finding>
}

/** The tool error a rejected brief fails with: what is wrong, and what to answer in the revision. */
export function rejection(agent: string, review: Review) {
  const by = review.evaluationID ? `S1 evaluation ${review.evaluationID}` : "the structural check"
  return [
    `The brief for the ${agent} subagent needs revision (${by}); nothing was launched.`,
    `Issues: ${review.issues.join(", ")}`,
    ...(review.findings?.length ? review.findings.map((finding) => `- ${finding.message}`) : []),
    "Answer these in a revised task call:",
    ...revision(review.issues).map((question) => `- ${question}`),
    "One revision is expected per request; a second rejection lets the task proceed with a warning.",
  ].join("\n")
}

/** What the parent is told about a brief that proceeded without a clean verdict; nothing when verified or skipped. */
export function note(review: Review) {
  const structure = review.findings?.length
    ? ` Structural notes: ${review.findings.map((finding) => finding.message).join(" ")}`
    : ""
  if (review.verdict === "unverified") return `Brief ${Intelligence.UNVERIFIED}.${structure}`
  if (review.verdict === "needs_revision")
    return `The revised brief still has issues (S1 evaluation ${review.evaluationID}): ${review.issues.join(", ")}. It proceeded after one revision; weigh the result against these gaps.`
  if (review.verdict === "inconclusive" && review.unavailable)
    return `S1 could not review the brief (${review.unavailable}); it proceeded unverified.${structure}`
  if (review.verdict === "inconclusive")
    return `S1 could not settle the brief (S1 evaluation ${review.evaluationID}): ${review.issues.join(", ")}. It proceeded unverified.`
  return undefined
}

/** The shape this needs from a message part; anything that is not a tool call is skipped. */
export interface Part {
  readonly type: string
  readonly tool?: string
  readonly callID?: string
  readonly state?: {
    readonly status: string
    readonly input?: unknown
    readonly output?: string
    readonly error?: string
    readonly metadata?: Readonly<Record<string, unknown>>
  }
}

export interface Violation {
  readonly tool: string
  readonly path: string
  readonly access: "read" | "write"
  readonly callID?: string
}

const ACCESS: Record<string, "read" | "write"> = {
  read: "read",
  edit: "write",
  write: "write",
  multiedit: "write",
  apply_patch: "write",
}

/**
 * Files the subagent read or changed outside its scope. Relative globs are matched against paths
 * relative to `directory`, a glob without wildcards also covers everything beneath it, and a file
 * outside `directory` is only in scope when an absolute glob names it. No scope means no boundary.
 */
export function scopeViolations(
  parts: ReadonlyArray<Part>,
  scope: ReadonlyArray<string> | undefined,
  directory?: string,
): Violation[] {
  const globs = strings(scope)
  if (!globs.length) return []
  // The same spelling task facts give tool paths: forward slashes, a lower-case drive.
  const root = directory ? SessionTaskFacts.paths("read", { path: directory })[0] : undefined
  return parts.flatMap((part) => {
    const access = part.type === "tool" && part.tool ? ACCESS[part.tool] : undefined
    if (!access || !part.tool || !part.state || part.state.status === "pending") return []
    const tool = part.tool
    return SessionTaskFacts.paths(tool, part.state.input, directory)
      .filter((file) => !globs.some((glob) => inScope(file, glob, root)))
      .map((file) => ({ tool, path: file, access, ...(part.callID ? { callID: part.callID } : {}) }))
  })
}

function inScope(file: string, glob: string, root: string | undefined) {
  const absolute = glob.startsWith("/") || /^[A-Za-z]:/.test(glob) || glob.startsWith("\\")
  const pattern = absolute
    ? SessionTaskFacts.paths("read", { path: glob })[0]!
    : glob
        .replaceAll("\\", "/")
        .replace(/^(\.\/)+/, "")
        .replace(/\/+$/, "")
  const target = absolute ? file : relative(file, root)
  if (target === undefined) return false
  if (!pattern || pattern === ".") return true
  return target === pattern || target.startsWith(`${pattern}/`) || minimatch(target, pattern, { dot: true })
}

/** `undefined` for a file outside the root, whose place in a relative scope is unknown. */
function relative(file: string, root: string | undefined) {
  if (!file.startsWith("/") && !/^[a-z]:/.test(file)) return file
  if (!root) return undefined
  if (file === root) return ""
  const prefix = root.endsWith("/") ? root : `${root}/`
  return file.startsWith(prefix) ? file.slice(prefix.length) : undefined
}

/** Reasons to look at a subagent's progress before the next interval. */
export type Signal = "loop_guard" | "scope_violation" | "tool_review_rejected" | "step_budget" | "stall"

export type Checkpoint =
  | { readonly type: "none" }
  | { readonly type: "interval" }
  | { readonly type: "signal"; readonly signals: ReadonlyArray<Signal> }

/**
 * Whether a progress checkpoint is due at `step`, given the step of the `last` one (0 before the
 * first). A signal is looked at right away; otherwise one checkpoint every `every` steps, where a
 * non-positive or infinite `every` turns the interval off. At most one checkpoint a step, and none
 * once `remaining` checkpoints reach zero.
 */
export function checkpointDue(input: {
  readonly step: number
  readonly last: number
  readonly every: number
  readonly signals: ReadonlyArray<Signal>
  readonly remaining?: number
}): Checkpoint {
  if (input.remaining !== undefined && input.remaining <= 0) return { type: "none" }
  if (input.step <= input.last) return { type: "none" }
  if (input.signals.length) return { type: "signal", signals: [...new Set(input.signals)] }
  if (input.every > 0 && Number.isFinite(input.every) && input.step - input.last >= input.every)
    return { type: "interval" }
  return { type: "none" }
}

export type ResultIssue = "empty_result" | "criteria_not_mentioned" | "no_successful_change"

export interface ResultFinding extends Finding<ResultIssue> {
  /** The done criteria the result never mentions. */
  readonly criteria?: ReadonlyArray<string>
}

/**
 * What a subagent's result structurally fails to show: no text, done criteria it never mentions,
 * or, when changes were asked for, no change or verification that ran successfully. Mentions are
 * judged by shared words, so this flags for review; it never proves a criterion was met.
 */
export function resultStructure(
  result: { readonly text: string; readonly parts: ReadonlyArray<Part> },
  brief: { readonly criteria?: ReadonlyArray<string>; readonly changesRequested: boolean },
): ResultFinding[] {
  if (!result.text.trim()) return [{ id: "empty_result", blocking: true, message: "The subagent returned no text." }]
  const have = words(result.text)
  const unmentioned = strings(brief.criteria).filter((criterion) => !mentioned(words(criterion), have))
  const changed = result.parts.some(
    (part) =>
      part.type === "tool" &&
      part.tool !== undefined &&
      part.state?.status === "completed" &&
      ["edit", "verification"].includes(SessionTaskFacts.kind(part.tool)),
  )
  return [
    ...(unmentioned.length
      ? [
          {
            id: "criteria_not_mentioned" as const,
            blocking: false,
            message: `The result does not mention ${unmentioned.length === 1 ? "a done criterion" : `${unmentioned.length} done criteria`}: ${unmentioned.join("; ")}`,
            criteria: unmentioned,
          },
        ]
      : []),
    ...(brief.changesRequested && !changed
      ? [
          {
            id: "no_successful_change" as const,
            blocking: false,
            message: "Changes were requested, but no edit or verification command completed successfully.",
          },
        ]
      : []),
  ]
}

/** How a subagent's result was judged against its brief before it went back to the parent. */
export type ResultDecision = "verified" | "inconclusive" | "needs_revision" | "unverified"

const RESULT_DECISIONS: ReadonlyArray<ResultDecision> = ["verified", "inconclusive", "needs_revision", "unverified"]

export interface ResultReview {
  readonly decision: ResultDecision
  /** S1's issue ids and the ids of blocking mechanical findings, without repeats. */
  readonly issues: ReadonlyArray<string>
  /** Whether the subagent had its one repair round before this verdict. */
  readonly repaired: boolean
  readonly evaluationID?: string
  /** Why S1 gave no verdict, when it could not be reached. */
  readonly unavailable?: string
  /** Mechanical findings; the only check single reasoning runs. */
  readonly findings?: ReadonlyArray<Finding>
}

export type ResultCheck = ResultIssue | "out_of_scope" | "failing_verification"

/**
 * The mechanical half of a result review, run in every reasoning mode before S1 is asked: what
 * {@link resultStructure} finds, files changed outside the scope, and verification commands whose
 * latest run failed. Only an empty result and a change outside the scope block on their own: a
 * failing command may be the honest report of a pre-existing failure, which S1 or the parent weighs.
 */
export function resultChecks(
  result: { readonly text: string; readonly parts: ReadonlyArray<Part> },
  brief: {
    readonly criteria?: ReadonlyArray<string>
    readonly scope?: ReadonlyArray<string>
    readonly changesRequested: boolean
    readonly directory?: string
  },
): Finding<ResultCheck>[] {
  const outside = [
    ...new Set(
      scopeViolations(result.parts, brief.scope, brief.directory)
        .filter((violation) => violation.access === "write")
        .map((violation) => violation.path),
    ),
  ]
  const failing = failingVerifications(result.parts)
  return [
    ...resultStructure(result, brief),
    ...(outside.length
      ? [
          {
            id: "out_of_scope" as const,
            blocking: true,
            message: `The subagent changed files outside its scope: ${outside.join(", ")}`,
          },
        ]
      : []),
    ...(failing.length
      ? [
          {
            id: "failing_verification" as const,
            blocking: false,
            message: `The latest run of these commands failed: ${failing
              .map((run) => (run.exit === undefined ? run.command : `${run.command} (exit ${run.exit})`))
              .join("; ")}`,
          },
        ]
      : []),
  ]
}

/**
 * Shell commands whose latest run failed: an error, or a non-zero exit code. A command that only
 * looks at things proves nothing either way (a grep with no match exits 1), so it is left out.
 */
export function failingVerifications(parts: ReadonlyArray<Part>) {
  const runs = parts.flatMap((part) => {
    if (part.type !== "tool" || (part.tool !== "bash" && part.tool !== "shell") || !part.state) return []
    if (part.state.status !== "completed" && part.state.status !== "error") return []
    if (SessionTaskFacts.readOnly(part.state.input)) return []
    const command = SessionTaskFacts.command(part.state.input)
    if (!command) return []
    const code = part.state.metadata?.exit
    const exit = typeof code === "number" ? code : undefined
    return [{ command, exit, failed: part.state.status === "error" || (exit !== undefined && exit !== 0) }]
  })
  // The last run of a command wins: a test that failed and then passed is passing.
  return [...new Map(runs.map((run) => [run.command, run])).values()].filter((run) => run.failed)
}

/** The most recent tool calls a result review shows S1; older ones are counted, not listed. */
export const DIGEST_CALLS = 40

/**
 * A bounded digest of the subagent's settled tool calls for S1: what ran, on which files, how it
 * ended, and the tail of what it printed, where the verdict of a command usually is.
 */
export function digest(
  parts: ReadonlyArray<Part>,
  input: { readonly directory?: string; readonly calls?: number } = {},
) {
  const calls = parts.flatMap((part) => {
    if (part.type !== "tool" || !part.tool || !part.state) return []
    if (part.state.status !== "completed" && part.state.status !== "error") return []
    const command = SessionTaskFacts.command(part.state.input, 200)
    const files = command ? [] : SessionTaskFacts.paths(part.tool, part.state.input, input.directory)
    const exit = part.state.metadata?.exit
    const output = part.state.status === "error" ? part.state.error : part.state.output
    return [
      {
        tool: part.tool,
        status: part.state.status,
        ...(command ? { command } : {}),
        ...(files.length ? { files } : {}),
        ...(!command && !files.length ? { input: clip(JSON.stringify(part.state.input) ?? "") } : {}),
        ...(typeof exit === "number" ? { exit } : {}),
        ...(output?.trim() ? { output: tail(output.trim()) } : {}),
      },
    ]
  })
  const limit = Math.max(1, input.calls ?? DIGEST_CALLS)
  return { total: calls.length, omitted: Math.max(0, calls.length - limit), calls: calls.slice(-limit) }
}

const clip = (text: string, size = 200) => ([...text].length > size ? `${[...text].slice(0, size).join("")}…` : text)
const tail = (text: string, size = 400) => ([...text].length > size ? `…${[...text].slice(-size).join("")}` : text)

/**
 * What S1 is asked about a result, against the brief and the digest of the subagent's tool calls. A
 * yes to any question is a gap between the result and the brief.
 */
export const resultQuestions = Intelligence.questions({
  unmet_criterion:
    "Is any criterion in sources.brief.done_criteria not met, judging by candidate and sources.tool_calls, or reported met without saying how it was checked? Answer no when there are no done criteria.",
  claim_without_evidence:
    "Does candidate claim a change, a passing check or a finding that no successful call in sources.tool_calls supports, such as tests or a build reported passing with no command that exited 0?",
  out_of_scope:
    "Did the subagent change files or systems outside sources.brief.scope or against the non-goals in sources.brief.prompt, per sources.tool_calls? Reading outside the scope for context is not an error.",
  missing_output:
    "Does candidate lack what sources.brief.return_format asks for, in content or in shape? When there is no return format, does it fail to answer what sources.brief.prompt asks for?",
  contradicts_brief:
    "Does candidate or sources.tool_calls contradict sources.brief.prompt: work toward a different objective, a non-goal done, or a stated constraint ignored?",
})

/**
 * The verdict from the mechanical findings and S1's evaluation. Single reasoning is unverified by
 * definition. A blocking finding needs revision whatever S1 says or whether it answered at all;
 * otherwise S1 that could not be reached leaves the result unverified, never silently verified.
 */
export function judge(input: {
  readonly findings: ReadonlyArray<Finding>
  readonly evaluation?: Pick<Intelligence.Evaluation, "id" | "decision" | "issues">
  readonly single: boolean
  readonly repaired: boolean
}): ResultReview {
  const findings = input.findings.length ? { findings: input.findings } : {}
  const evaluationID = input.evaluation ? { evaluationID: input.evaluation.id } : {}
  if (input.single)
    return {
      decision: "unverified",
      issues: input.findings.map((finding) => finding.id),
      repaired: input.repaired,
      ...findings,
    }
  const blocking = input.findings.filter((finding) => finding.blocking).map((finding) => finding.id)
  const raised =
    input.evaluation?.decision === "needs_revision" || input.evaluation?.decision === "inconclusive"
      ? input.evaluation.issues
      : []
  if (blocking.length)
    return {
      decision: "needs_revision",
      issues: [...new Set([...raised, ...blocking])],
      repaired: input.repaired,
      ...evaluationID,
      ...findings,
    }
  if (!input.evaluation || input.evaluation.decision === "unavailable")
    return {
      decision: "unverified",
      issues: input.findings.map((finding) => finding.id),
      repaired: input.repaired,
      // The engine's wording is for gates that keep a previous state; a result has none.
      unavailable:
        input.evaluation?.issues[0]?.replace(/ Previous state preserved\.$/, "") ?? "System One is not enabled",
      ...evaluationID,
      ...findings,
    }
  if (input.evaluation.decision === "accepted")
    return { decision: "verified", issues: [], repaired: input.repaired, ...evaluationID }
  return {
    decision: input.evaluation.decision,
    issues: [...new Set(raised)],
    repaired: input.repaired,
    ...evaluationID,
    ...findings,
  }
}

/** Opens the synthetic message that sends a subagent back to repair its result. */
export const REPAIR = "[system:subagent-result-repair]"

const REPAIR_ASKS: Record<string, string> = {
  empty_result: "Hand back a written result; the last one had no text.",
  criteria_not_mentioned: "Report each done criterion and the evidence that it holds.",
  no_successful_change: "Make the requested change, and run a check that shows it works.",
  out_of_scope: "Undo or justify every change outside the scope; change only files the scope allows.",
  failing_verification:
    "Fix what makes the failing commands fail, or say plainly why they fail and that the work is not done.",
  unmet_criterion: "Meet every done criterion, or say which one is not met and why.",
  claim_without_evidence: "Back every claim with a command or tool result from this session, or withdraw it.",
  missing_output: "Hand back exactly what the return format asks for, in its shape.",
  contradicts_brief: "Bring the work back to the brief's objective and constraints.",
}

/** The one repair round's message: what fell short, and what to hand back. */
export function repair(review: Pick<ResultReview, "issues" | "findings">) {
  const asks = [
    ...new Set(
      review.issues.map((issue) => REPAIR_ASKS[issue.replace(/^\d+:/, "")]).filter((item) => item !== undefined),
    ),
  ]
  return [
    REPAIR,
    `Your parent reviewed this result against your brief and it falls short: ${review.issues.join(", ")}.`,
    ...(review.findings ?? []).map((finding) => `- ${finding.message}`),
    ...asks.map((ask) => `- ${ask}`),
    "Stay within the brief's scope, then hand back the complete result again in the requested return format. This is the only repair round.",
  ].join("\n")
}

/** The `<review>` block the parent reads in the task envelope. */
export function reviewBlock(review: ResultReview) {
  const by = review.evaluationID ? ` (S1 evaluation ${review.evaluationID})` : ""
  const round = review.repaired ? " after one repair round" : ""
  const notes = review.findings?.length ? ` ${review.findings.map((finding) => finding.message).join(" ")}` : ""
  const body =
    review.decision === "verified"
      ? `The result was checked against the brief${by}${round} and no gap was found.`
      : review.decision === "needs_revision"
        ? `The result still falls short of the brief${round}${by}: ${review.issues.join(", ")}.${notes} Verify these yourself or re-delegate before relying on it.`
        : review.decision === "inconclusive"
          ? `The review could not settle the result${by}${round}: ${review.issues.join(", ")}.${notes} Check the claims that matter before relying on them.`
          : review.unavailable
            ? `S1 could not review the result (${review.unavailable}); treat it as unchecked.${notes}`
            : `Result ${Intelligence.UNVERIFIED}; only mechanical checks ran. Treat it as unchecked.${notes}`
  return `<review decision="${review.decision}"${review.repaired ? ` repaired="true"` : ""}>${body}</review>`
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "word" })

/** Words that carry meaning in any script: short Latin-style words drop out, ideographs and numbers stay. */
function words(text: string) {
  return new Set(
    [...segmenter.segment(text.toLocaleLowerCase())]
      .filter(
        (segment) =>
          segment.isWordLike && ([...segment.segment].length > 2 || /[\p{Ideographic}\p{N}]/u.test(segment.segment)),
      )
      .map((segment) => segment.segment),
  )
}

function mentioned(want: Set<string>, have: Set<string>) {
  if (!want.size) return true
  return [...want].filter((word) => have.has(word)).length / want.size >= 0.5
}

function strings(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
}

export * as SubagentReview from "./subagent-review"
