#!/usr/bin/env bun

/**
 * Live prompt-classification evaluation.
 *
 *   bun run eval:classification
 *   bun run eval:classification --runs 3 --filter release --output ./classification-report.json
 *   bun run eval:classification --transport opencode-zen,openrouter --runs 3
 *
 * OpenCode Zen uses its public JEV access. Other transports read the same provider environment
 * variables as the production Intelligence service.
 */

import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { Effect, Schema } from "effect"
import { Intelligence } from "../src/intelligence"
import { Evaluation, Response } from "@reddb-io/redcode-schema/intelligence"

const Transport = Schema.Literals(["opencode-zen", "openrouter", "typesafe", "red-router"])
const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown)

interface RangeValue {
  readonly min: number
  readonly max: number
}

export interface ClassificationExpected {
  readonly work_route: string
  readonly change_kind?: string
  readonly impact?: RangeValue
  readonly time_pressure: string
  readonly interaction_constraint: string
  readonly clarification: "proceed" | "inspect" | "ask"
  readonly complexity?: RangeValue
  readonly consequence?: RangeValue
  readonly frustration?: RangeValue
  readonly priority?: "low" | "medium" | "high"
}

export interface ClassificationFixture {
  readonly id: string
  readonly prompt: string
  readonly history?: readonly string[]
  readonly expected: ClassificationExpected
}

interface ClassificationDataset {
  readonly version: number
  readonly language: "en" | "multilingual"
  readonly cases: readonly ClassificationFixture[]
}

function decodeDataset(input: unknown): ClassificationDataset {
  const value = Schema.decodeUnknownSync(UnknownRecord)(input)
  return {
    version: Schema.decodeUnknownSync(Schema.Int)(value.version),
    language: Schema.decodeUnknownSync(Schema.Literals(["en", "multilingual"]))(value.language),
    cases: Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(value.cases).map(decodeFixture),
  }
}

function decodeFixture(input: unknown): ClassificationFixture {
  const value = Schema.decodeUnknownSync(UnknownRecord)(input)
  const expected = Schema.decodeUnknownSync(UnknownRecord)(value.expected)
  const optionalString = (key: string) =>
    expected[key] === undefined ? undefined : Schema.decodeUnknownSync(Schema.String)(expected[key])
  const optionalRange = (key: string) => {
    if (expected[key] === undefined) return undefined
    const range = Schema.decodeUnknownSync(UnknownRecord)(expected[key])
    return {
      min: Schema.decodeUnknownSync(Schema.Number)(range.min),
      max: Schema.decodeUnknownSync(Schema.Number)(range.max),
    }
  }
  return {
    id: Schema.decodeUnknownSync(Schema.String)(value.id),
    prompt: Schema.decodeUnknownSync(Schema.String)(value.prompt),
    ...(value.history === undefined
      ? {}
      : { history: Schema.decodeUnknownSync(Schema.Array(Schema.String))(value.history) }),
    expected: {
      work_route: Schema.decodeUnknownSync(Schema.String)(expected.work_route),
      ...(optionalString("change_kind") ? { change_kind: optionalString("change_kind") } : {}),
      ...(optionalRange("impact") ? { impact: optionalRange("impact") } : {}),
      time_pressure: Schema.decodeUnknownSync(Schema.String)(expected.time_pressure),
      interaction_constraint: Schema.decodeUnknownSync(Schema.String)(expected.interaction_constraint),
      clarification: Schema.decodeUnknownSync(Schema.Literals(["proceed", "inspect", "ask"]))(expected.clarification),
      ...(optionalRange("complexity") ? { complexity: optionalRange("complexity") } : {}),
      ...(optionalRange("consequence") ? { consequence: optionalRange("consequence") } : {}),
      ...(optionalRange("frustration") ? { frustration: optionalRange("frustration") } : {}),
      ...(expected.priority === undefined
        ? {}
        : {
            priority: Schema.decodeUnknownSync(Schema.Literals(["low", "medium", "high"]))(expected.priority),
          }),
    },
  }
}

type IntelligenceResponse = typeof Response.Type

export interface Args {
  transports: (typeof Transport.Type)[]
  runs: number
  concurrency: number
  filters: string[]
  output?: string
  minAccuracy?: number
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { transports: [], runs: 1, concurrency: 4, filters: [] }
  const value = (index: number, flag: string) => {
    const next = argv[index + 1]
    if (!next || next.startsWith("--")) throw new Error(`${flag} needs a value`)
    return next
  }
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!
    const [flag, inline] = argument.includes("=")
      ? [argument.slice(0, argument.indexOf("=")), argument.slice(argument.indexOf("=") + 1)]
      : [argument, undefined]
    const take = () => inline ?? value(index++, flag)
    if (flag === "--transport") {
      args.transports.push(
        ...take()
          .split(",")
          .map((item) => Schema.decodeUnknownSync(Transport)(item.trim())),
      )
      continue
    }
    if (flag === "--runs") {
      args.runs = positiveInteger(take(), flag)
      continue
    }
    if (flag === "--concurrency") {
      args.concurrency = positiveInteger(take(), flag)
      continue
    }
    if (flag === "--filter") {
      args.filters.push(take())
      continue
    }
    if (flag === "--output") {
      args.output = take()
      continue
    }
    if (flag === "--min-accuracy") {
      args.minAccuracy = Number(take())
      if (!Number.isFinite(args.minAccuracy) || args.minAccuracy < 0 || args.minAccuracy > 1)
        throw new Error("--min-accuracy must be between 0 and 1")
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  if (!args.transports.length) args.transports.push("opencode-zen")
  args.transports = [...new Set(args.transports)]
  return args
}

function positiveInteger(value: string, flag: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

interface Assertion {
  field: string
  expected: string | { min: number; max: number }
  actual: string | number
  confidence?: number
  pass: boolean
}

export function clarification(value: number) {
  if (value >= 0.8) return "ask" as const
  if (value > 0.2) return "inspect" as const
  return "proceed" as const
}

export function score(
  fixture: ClassificationFixture,
  response: IntelligenceResponse,
): { assertions: Assertion[]; signature: string; priority?: "low" | "medium" | "high" } {
  const assertions: Assertion[] = []
  const choice = (field: string, expected: string) => {
    const answer = response.answers[field]
    assertions.push({
      field,
      expected,
      actual: answer?.type === "choice" ? answer.choice : "missing",
      ...(answer?.type === "choice" ? { confidence: answer.confidence } : {}),
      pass: answer?.type === "choice" && answer.choice === expected,
    })
  }
  const ranged = (field: string, expected: { min: number; max: number } | undefined) => {
    if (!expected) return
    const answer = response.answers[field]
    assertions.push({
      field,
      expected,
      actual: answer?.type === "score" ? answer.score : "missing",
      ...(answer?.type === "score" ? { confidence: answer.confidence } : {}),
      pass: answer?.type === "score" && answer.score >= expected.min && answer.score <= expected.max,
    })
  }
  choice("work_route", fixture.expected.work_route)
  if (fixture.expected.change_kind) choice("change_kind", fixture.expected.change_kind)
  ranged("impact", fixture.expected.impact)
  choice("time_pressure", fixture.expected.time_pressure)
  choice("interaction_constraint", fixture.expected.interaction_constraint)
  ranged("complexity", fixture.expected.complexity)
  ranged("consequence", fixture.expected.consequence)
  ranged("frustration", fixture.expected.frustration)
  const clarify = response.answers.must_clarify
  const clarificationBand = clarify?.type === "noul" ? clarification(clarify.noul) : "missing"
  assertions.push({
    field: "clarification",
    expected: fixture.expected.clarification,
    actual: clarificationBand,
    pass: clarificationBand === fixture.expected.clarification,
  })
  const evaluation: typeof Evaluation.Type = {
    id: fixture.id,
    fingerprint: fixture.id,
    sessionID: "classification-eval",
    operation: "prompt_classification",
    kind: "classification",
    policy: Intelligence.POLICY,
    decision: "accepted",
    model: response.model,
    answers: response.answers,
    issues: [],
    created: 0,
    duration: 0,
    usage: response.usage,
  }
  const priority = Intelligence.promptPriority(evaluation)
  if (fixture.expected.priority)
    assertions.push({
      field: "priority",
      expected: fixture.expected.priority,
      actual: priority ?? "default",
      pass: priority === fixture.expected.priority,
    })
  return {
    assertions,
    priority,
    signature: JSON.stringify({
      work_route: selectedChoice(response.answers.work_route),
      change_kind: selectedChoice(response.answers.change_kind),
      impact: roundedScore(response.answers.impact),
      time_pressure: selectedChoice(response.answers.time_pressure),
      interaction_constraint: selectedChoice(response.answers.interaction_constraint),
      clarification: clarificationBand,
      complexity: roundedScore(response.answers.complexity),
      consequence: roundedScore(response.answers.consequence),
      frustration: roundedScore(response.answers.frustration),
      priority,
    }),
  }
}

function selectedChoice(answer: IntelligenceResponse["answers"][string] | undefined) {
  return answer?.type === "choice" ? answer.choice : undefined
}

function roundedScore(answer: IntelligenceResponse["answers"][string] | undefined) {
  return answer?.type === "score" ? Math.round(answer.score * 10) / 10 : undefined
}

function percentile(values: readonly number[], quantile: number) {
  if (!values.length) return 0
  return values.toSorted((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1)]!
}

function average(values: readonly number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null
}

interface MeasuredRun {
  readonly caseID: string
  readonly latencyMs: number
  readonly usage: IntelligenceResponse["usage"]
  readonly assertions: Assertion[]
  readonly signature: string
}

export interface ClassificationSummary {
  readonly accuracy: number
  readonly assertions: { readonly passed: number; readonly total: number }
  readonly fields: Record<string, { readonly accuracy: number; readonly averageConfidence: number | null }>
  readonly stability: {
    readonly average: number | null
    readonly cases: readonly { readonly caseID: string; readonly agreement: number | null }[]
  }
  readonly latencyMs: { readonly average: number | null; readonly p50: number; readonly p95: number }
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number }
}

export function summarize(runs: readonly MeasuredRun[]): ClassificationSummary {
  const assertions = runs.flatMap((run) => run.assertions)
  const fields = [...new Set(assertions.map((assertion) => assertion.field))]
  const stability = [...new Set(runs.map((run) => run.caseID))].map((caseID) => {
    const signatures = runs.filter((run) => run.caseID === caseID).map((run) => run.signature)
    const counts = Object.values(Object.groupBy(signatures, (signature) => signature)).map(
      (items) => items?.length ?? 0,
    )
    return { caseID, agreement: signatures.length < 2 ? null : Math.max(...counts) / signatures.length }
  })
  return {
    accuracy: assertions.filter((assertion) => assertion.pass).length / assertions.length,
    assertions: { passed: assertions.filter((assertion) => assertion.pass).length, total: assertions.length },
    fields: Object.fromEntries(
      fields.map((field) => {
        const selected = assertions.filter((assertion) => assertion.field === field)
        return [
          field,
          {
            accuracy: selected.filter((assertion) => assertion.pass).length / selected.length,
            averageConfidence: average(
              selected.flatMap((assertion) => (assertion.confidence === undefined ? [] : [assertion.confidence])),
            ),
          },
        ]
      }),
    ),
    stability: {
      average: average(stability.flatMap((item) => (item.agreement === null ? [] : [item.agreement]))),
      cases: stability,
    },
    latencyMs: {
      average: average(runs.map((run) => run.latencyMs)),
      p50: percentile(
        runs.map((run) => run.latencyMs),
        0.5,
      ),
      p95: percentile(
        runs.map((run) => run.latencyMs),
        0.95,
      ),
    },
    usage: runs.reduce(
      (total, run) => ({
        input_tokens: total.input_tokens + run.usage.input_tokens,
        output_tokens: total.output_tokens + run.usage.output_tokens,
      }),
      { input_tokens: 0, output_tokens: 0 },
    ),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const dataset = decodeDataset(
    await Bun.file(new URL("./fixtures/prompt-classification-eval.json", import.meta.url)).json(),
  )
  const fixtures = dataset.cases.filter(
    (fixture) => !args.filters.length || args.filters.some((filter) => fixture.id.includes(filter)),
  )
  if (!fixtures.length) throw new Error("No dataset cases matched --filter")
  const root = await mkdtemp(path.join(tmpdir(), "redcode-classification-eval-"))
  try {
    const service = await Effect.runPromise(
      Intelligence.make(root, {
        get: () => Effect.succeed(undefined),
        list: () => Effect.succeed([]),
        create: () => Effect.die("Evaluation harness never stores credentials"),
      }),
    )
    const reports = []
    for (const transport of args.transports) {
      const evaluator = Intelligence.evaluatorPreset(transport)
      const jobs = fixtures.flatMap((fixture) =>
        Array.from({ length: args.runs }, (_, repetition) => ({ fixture, repetition })),
      )
      const runs = await Effect.runPromise(
        Effect.forEach(
          jobs,
          (job) =>
            Effect.gen(function* () {
              const started = performance.now()
              const response = yield* service
                .request(evaluator, "systemone", {
                  model: evaluator.model,
                  state: {
                    sources: {
                      text: job.fixture.prompt,
                      ...(job.fixture.history ? { history: job.fixture.history } : {}),
                    },
                  },
                  questions: Intelligence.promptQuestions,
                })
                .pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Response)),
                  Effect.tap((response) =>
                    Effect.sync(() => Intelligence.validateClassification(Intelligence.promptQuestions, response)),
                  ),
                )
              return {
                caseID: job.fixture.id,
                repetition: job.repetition,
                latencyMs: performance.now() - started,
                usage: response.usage,
                response,
                ...score(job.fixture, response),
              }
            }),
          { concurrency: args.concurrency },
        ),
      )
      reports.push({
        transport,
        model: evaluator.model,
        summary: summarize(runs),
        cases: runs,
      })
    }
    const report = {
      dataset: { version: dataset.version, language: dataset.language, cases: fixtures.length },
      policy: Intelligence.POLICY,
      repetitions: args.runs,
      generatedAt: new Date().toISOString(),
      providers: reports,
    }
    const output = JSON.stringify(report, null, 2)
    if (args.output) await Bun.write(path.resolve(args.output), output)
    console.log(output)
    const minAccuracy = args.minAccuracy
    const belowThreshold =
      minAccuracy === undefined ? false : reports.some((report) => report.summary.accuracy < minAccuracy)
    if (belowThreshold) process.exitCode = 1
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

if (import.meta.main) await main()
