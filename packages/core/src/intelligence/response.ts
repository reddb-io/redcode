export * as IntelligenceResponse from "./response.js"

import { Redact } from "@opencode/util/redact"
import { Intelligence } from "@opencode/schema/intelligence"
import type { EvaluationInput } from "../intelligence.js"
import { IntelligenceEvaluation } from "./evaluation.js"

/**
 * System One review of the agent's final response. S1 validates the answer against the request
 * and bounded tool evidence; an established issue earns one repair pass, and anything left
 * standing is kept with a visible note. Unavailable review never approves an answer silently.
 */

/** Synthetic metadata on a repair prompt; surfaces fold the revision and its original into one reply. */
export const REPAIR_KEY = "responseRepair"
/** Synthetic metadata on the note that records how the final response review ended. */
export const REVIEW_KEY = "responseReview"
/** Repair passes per final response. */
export const REPAIRS = 1

export const QUESTIONS: Record<string, Intelligence.Question> = IntelligenceEvaluation.questions({
  correctness:
    "Does candidate contain a factual or logical error contradicted by the request or available evidence? Compare actual behavior with intended behavior and check the requested result. Missing evidence alone does not establish an error.",
  omission: "Does candidate fail to answer an applicable user request or question in sources?",
  // Only claims of performed or verified work: a greeting or a statement of readiness is not one.
  unsupported:
    "Does candidate claim it performed or verified work, such as making edits, running commands or tests, completing tasks or checking results, that sources.tasks, sources.goal and sources.tools do not support? Conversational statements, such as greetings, saying it is ready, plans or offers of help, are not claims of work.",
  tool_evidence:
    "Does candidate rely on a failed, partial, irrelevant or ambiguous result in sources.tools as if it proved the claimed outcome?",
  premature:
    "Does candidate present the overall task as complete while sources contain unfinished tasks, an active goal or a blocker?",
  writing:
    "Does candidate have a material writing defect that makes the result, remaining work or next action hard to understand?",
  refusal:
    "Does candidate refuse, withhold help on, or add an unwarranted safety warning to the latest request in sources when that request is ordinary software work with no concrete sign of harm? Declining a request to cause harm, evade authorization or falsify results is not this issue, and neither is asking for a missing detail.",
})

/** Plain-language reasons for the question ids, shown to the user instead of the raw key. */
export const REASONS: Record<string, string> = {
  correctness: "gave an incorrect result",
  omission: "missed part of the request",
  unsupported: "claimed work it could not prove",
  tool_evidence: "relied on a failed or unrelated result",
  premature: "said done with work still open",
  writing: "was hard to follow",
  refusal: "refused or warned without cause",
}

export const reason = (id: string) => REASONS[id] ?? "did not pass review"

/**
 * The checks that apply to an answer. Tool evidence needs tool results and a premature finish
 * needs tasks or an active goal; asking either without them only invites a false positive. A
 * plain answer still needs correctness and request coverage checks.
 */
export function questionsFor(input: {
  readonly tools: boolean
  readonly tasks: boolean
  readonly goal: boolean
  readonly route?: string
}) {
  return Object.fromEntries(
    Object.entries(QUESTIONS).filter(
      ([id]) => (id !== "tool_evidence" || input.tools) && (id !== "premature" || input.tasks || input.goal),
    ),
  )
}

/** The `response_quality` evaluation of a final response, bounded on every source. */
export function evaluation(input: {
  readonly sessionID: string
  readonly request: { readonly id: string; readonly text: string }
  readonly candidate: { readonly id: string; readonly text: string }
  readonly attempt: number
  readonly tools: { readonly total: number; readonly calls: ReadonlyArray<unknown> }
  readonly tasks: ReadonlyArray<unknown>
  readonly goal: unknown
  readonly route?: string
  readonly scrub?: (text: string) => string
}): EvaluationInput {
  const clean = (value: unknown) => {
    const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "null")
    return Redact.redact(input.scrub ? input.scrub(text) : text)
  }
  return {
    sessionID: input.sessionID,
    operation: "response_quality",
    kind: "gate",
    subjectID: input.request.id,
    candidateID: input.candidate.id,
    attempt: input.attempt,
    sources: {
      request: IntelligenceEvaluation.evidence(clean(input.request.text), {
        reference: input.request.id,
        limit: 6_000,
      }),
      tasks: IntelligenceEvaluation.evidence(clean(input.tasks), {
        reference: `${input.sessionID}/tasks`,
        limit: 3_000,
      }),
      goal: IntelligenceEvaluation.evidence(clean(input.goal ?? null), {
        reference: `${input.sessionID}/goal`,
        limit: 2_000,
      }),
      freshness:
        "Only successful, settled, fresh checks support verification. An edit invalidates earlier overlapping checks. Truncated text is not complete evidence; retrieve by durable IDs.",
      tools: IntelligenceEvaluation.evidence(clean(input.tools), {
        reference: `${input.sessionID}/tools`,
        limit: 36_000,
      }),
    },
    candidate: IntelligenceEvaluation.evidence(clean(input.candidate.text), {
      reference: input.candidate.id,
      limit: 6_000,
    }),
    questions: questionsFor({
      tools: input.tools.total > 0,
      tasks: input.tasks.length > 0,
      goal: input.goal !== undefined && input.goal !== null,
      route: input.route,
    }),
  }
}

/**
 * The issues a review establishes (`unresolved`) and those that still earn a repair (`repair`).
 * Only answers at or above the repair confidence count: repairing a doubtful issue rewrites a sound
 * answer. An issue already repaired is never repaired again.
 */
export function verdict(evaluation: Intelligence.Evaluation | undefined, repaired: ReadonlyArray<string>) {
  const established =
    !evaluation || evaluation.mode === "observe" || evaluation.decision === "unavailable"
      ? []
      : evaluation.issues.filter((id) => {
          const answer = evaluation.answers[id]
          return answer?.type === "noul" && answer.noul >= Intelligence.REPAIR_CONFIDENCE
        })
  return { repair: established.filter((id) => !repaired.includes(id)), unresolved: established }
}

/** The confidence S1 gave each named issue, for surfaces to show beside the reason. */
export function confidence(evaluation: Intelligence.Evaluation | undefined, issues: ReadonlyArray<string>) {
  return Object.fromEntries(
    issues.flatMap((id) => {
      const answer = evaluation && evaluation.decision !== "unavailable" ? evaluation.answers[id] : undefined
      return answer?.type === "noul" ? [[id, answer.noul] as const] : []
    }),
  )
}

/** The synthetic prompt that asks for the final response again, fixed for established issues. */
export function repairPrompt(issues: ReadonlyArray<string>) {
  return [
    `System One review found these issues in your final response: ${issues.map((id) => `${id} (${reason(id)})`).join(", ")}.`,
    ...(issues.includes("refusal")
      ? [
          "The request is ordinary software work; answer or do it directly, without a safety disclaimer, unless the conversation shows concrete harm.",
        ]
      : []),
    "Fix what is actually wrong, then write the final response again in full. It replaces the previous one for the user, so do not acknowledge or mention this review. If no issue is real, repeat the previous response unchanged.",
  ].join("\n")
}

/**
 * Whether a revision is materially the same as the response it revises: equal once case, spacing,
 * punctuation and symbols are ignored, or sharing nearly all character pairs. Character pairs
 * compare every script alike, including those written without spaces.
 */
export function same(previous: string, next: string) {
  const normalize = (text: string) =>
    text
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[\p{P}\p{S}\s]+/gu, " ")
      .trim()
  const left = normalize(previous)
  const right = normalize(next)
  if (left === right) return true
  const pairs = (text: string) => {
    const characters = [...text]
    return characters.slice(1).map((character, index) => characters[index] + character)
  }
  const before = pairs(left)
  const after = pairs(right)
  if (!before.length || !after.length) return false
  const remaining = before.reduce(
    (counts, pair) => counts.set(pair, (counts.get(pair) ?? 0) + 1),
    new Map<string, number>(),
  )
  const shared = after.filter((pair) => {
    const count = remaining.get(pair) ?? 0
    if (!count) return false
    remaining.set(pair, count - 1)
    return true
  }).length
  return (2 * shared) / (before.length + after.length) >= 0.9
}

export type Outcome =
  | { readonly status: "revised"; readonly issues: ReadonlyArray<string> }
  | {
      readonly status: "unresolved"
      readonly evaluationID?: string
      readonly issues: ReadonlyArray<string>
      readonly confidence: Record<string, number>
      readonly revised: boolean
    }
  | {
      readonly status: "unavailable"
      readonly evaluationID?: string
      readonly detail: string
      readonly revised: boolean
    }

/** The durable note a surface shows under the final response, and the text the model reads later. */
export function note(outcome: Outcome) {
  if (outcome.status === "revised") {
    const reasons = outcome.issues.map(reason).join("; ")
    return {
      description: `Revised after S1 review: ${reasons}`,
      text: `The final response above was revised once after System One review (${outcome.issues.join(", ")}) and then accepted.`,
    }
  }
  if (outcome.status === "unresolved") {
    const reasons = outcome.issues
      .map((id) => {
        const value = outcome.confidence[id]
        return value === undefined ? reason(id) : `${Math.round(value * 100)}% sure the answer ${reason(id)}`
      })
      .join("; ")
    return {
      description: `S1 review unresolved${outcome.revised ? " after revision" : ""}: ${reasons}`,
      text: `System One response review${outcome.evaluationID ? ` (${outcome.evaluationID})` : ""} left these issues unresolved${outcome.revised ? " after one revision" : ""}: ${outcome.issues.join(", ")}. The response was kept; its completion has not been verified, so preserve outstanding work and state these limits when relevant.`,
    }
  }
  return {
    description: `S1 review unavailable: the final response was not verified`,
    text: `System One response review unavailable${outcome.evaluationID ? ` (${outcome.evaluationID})` : ""}: ${outcome.detail}. The final response was kept without review; its completion has not been verified.`,
  }
}
