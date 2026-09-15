/**
 * An LLM judge scoring a run against rubric criteria. Off unless a judge model is configured;
 * the transport is injected so the framework tests never reach a provider.
 */
import type { RunRecord } from "./record"

export interface Criterion {
  readonly name: string
  readonly description: string
  readonly weight?: number
}

export interface Rubric {
  readonly criteria: readonly Criterion[]
  /** Weighted score in [0, 1] needed to pass. Default 0.7. */
  readonly threshold?: number
  /** What the judge sees: the final answer only, or the tool trail too. Default transcript. */
  readonly subject?: "final" | "transcript"
}

export interface Transport {
  readonly model: string
  readonly family?: string
  readonly complete: (prompt: string) => Promise<string>
}

export interface Score {
  readonly name: string
  readonly score: number
  readonly reason: string
}

export interface Verdict {
  readonly judge: string
  readonly scores: readonly Score[]
  readonly score: number
  readonly pass: boolean
  readonly warnings: readonly string[]
}

// Ordered: the first pattern that matches names the family.
const FAMILIES: ReadonlyArray<[string, RegExp]> = [
  ["claude", /claude|anthropic|opus|sonnet|haiku|fable/],
  ["gpt", /\bgpt|openai|\bo[134](-|$)|codex/],
  ["gemini", /gemini|gemma|google/],
  ["glm", /glm|zhipu|z-ai|zai/],
  ["qwen", /qwen|alibaba|qwq/],
  ["deepseek", /deepseek/],
  ["grok", /grok|xai/],
  ["llama", /llama|meta-/],
  ["mistral", /mistral|mixtral|codestral|devstral/],
  ["kimi", /kimi|moonshot/],
  ["minimax", /minimax/],
]

/** The model family, from the catalog when it knows, else from the model slug. */
export function familyOf(model: string, catalogFamily?: string) {
  const text = `${catalogFamily ?? ""} ${model}`.toLowerCase()
  const byName = FAMILIES.find(([, pattern]) => pattern.test(text))
  if (byName) return byName[0]
  if (catalogFamily) return catalogFamily.toLowerCase()
  return model.slice(model.indexOf("/") + 1).split(/[-.:]/)[0]!.toLowerCase()
}

export function sameFamilyWarning(judge: string, candidate: string, families?: { judge?: string; candidate?: string }) {
  const a = familyOf(judge, families?.judge)
  const b = familyOf(candidate, families?.candidate)
  if (a !== b) return undefined
  return `judge ${judge} and candidate ${candidate} are both ${a} models; a judge tends to favour its own family`
}

export function prompt(run: RunRecord, rubric: Rubric, task: string) {
  const trail =
    rubric.subject === "final"
      ? ""
      : `\nTool calls, in order:\n${run.tools
          .map((call) => `- ${call.tool} ${JSON.stringify(call.input).slice(0, 300)} -> ${call.status}`)
          .join("\n")}\n`
  return [
    "You are grading an AI coding agent's run against a rubric. Score each criterion from 0 to 1.",
    `Task given to the agent:\n${task}`,
    trail,
    `Final answer:\n${run.text || "(none)"}`,
    `Outcome recorded by the harness: ${run.outcome}${run.reason ? ` (${run.reason})` : ""}`,
    "Criteria:",
    ...rubric.criteria.map((item) => `- ${item.name}: ${item.description}`),
    'Reply with JSON only: {"scores":[{"name":"<criterion>","score":0.0,"reason":"<one sentence>"}]}',
  ].join("\n")
}

export function parse(text: string, rubric: Rubric): Score[] {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error(`judge reply is not JSON: ${text.slice(0, 200)}`)
  const body = JSON.parse(text.slice(start, end + 1)) as { scores?: { name?: unknown; score?: unknown; reason?: unknown }[] }
  return rubric.criteria.map((criterion) => {
    const found = body.scores?.find((item) => item.name === criterion.name)
    const score = typeof found?.score === "number" ? Math.min(1, Math.max(0, found.score)) : 0
    return {
      name: criterion.name,
      score,
      reason: typeof found?.reason === "string" ? found.reason : found ? "" : "the judge did not score this criterion",
    }
  })
}

export function weigh(scores: readonly Score[], rubric: Rubric) {
  const weights = rubric.criteria.map((item) => item.weight ?? 1)
  const total = weights.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return 0
  return scores.reduce((sum, item, i) => sum + item.score * weights[i]!, 0) / total
}

export async function judge(input: {
  run: RunRecord
  rubric: Rubric
  task: string
  transport: Transport
  candidateFamily?: string
}): Promise<Verdict> {
  const warning = sameFamilyWarning(input.transport.model, input.run.model, {
    judge: input.transport.family,
    candidate: input.candidateFamily,
  })
  const reply = await input.transport.complete(prompt(input.run, input.rubric, input.task))
  const scores = parse(reply, input.rubric)
  const score = weigh(scores, input.rubric)
  return {
    judge: input.transport.model,
    scores,
    score,
    pass: score >= (input.rubric.threshold ?? 0.7),
    warnings: warning ? [warning] : [],
  }
}

export * as EvalJudge from "./judge"
