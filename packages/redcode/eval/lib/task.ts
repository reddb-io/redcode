/**
 * `task(name, spec, assertions)` registers one eval as a bun test: set up the workspace, run the
 * prompt to completion within its budgets, capture the record, run the assertions, append the
 * history row. The test fails when the run did not complete or any assertion failed.
 */
import { test } from "bun:test"
import { EvalOptions, type Options } from "./options"
import { EvalHarness, DEFAULT_BUDGET, type Spec, type Outcome } from "./harness"
import { Expectations, format } from "./assert"
import { EvalHistory } from "./history"
import { EvalJudge, type Rubric, type Transport } from "./judge"
import { ScriptedProvider } from "./scripted-provider"

export class Run extends Expectations {
  readonly warnings: string[] = []

  constructor(
    readonly outcome: Outcome,
    private readonly spec: Spec,
    private readonly judgeTransport: Transport | undefined,
    private readonly candidateFamily: string | undefined,
  ) {
    super(outcome.record, { workspace: outcome.workspace })
  }

  get workspace() {
    return this.outcome.workspace
  }

  /** Calls the fake MCP servers received, by server name. */
  mcpCalls(server: string) {
    return this.outcome.mcp.find((item) => item.name === server)?.calls ?? []
  }

  /**
   * Scores the run with the configured judge model. Off by default: without `--judge` (which
   * needs live mode) the criterion is recorded as skipped and does not affect the verdict.
   */
  async judge(rubric: Rubric) {
    const transport = this.judgeTransport
    if (!transport) return this.that("judge", true, "skipped: no judge model configured (--judge, live only)")
    const verdict = await EvalJudge.judge({
      run: this.record,
      rubric,
      task: this.spec.prompt,
      transport,
      candidateFamily: this.candidateFamily,
    })
    for (const warning of verdict.warnings) {
      this.warnings.push(warning)
      console.warn(`[eval] warning: ${warning}`)
    }
    return this.that(
      `judge(${verdict.judge})`,
      verdict.pass,
      `score ${verdict.score.toFixed(2)}: ${verdict.scores.map((item) => `${item.name}=${item.score}`).join(", ")}`,
    )
  }
}

let cached: Options | undefined
export function options() {
  cached ??= EvalOptions.parse(process.env)
  return cached
}

export function task(name: string, spec: Spec, assertions: (run: Run) => void | Promise<void>) {
  const budget = spec.budget?.ms ?? DEFAULT_BUDGET.ms
  test(
    name,
    async () => {
      const opts = options()
      const run = await EvalHarness.run({
        name,
        spec,
        options: opts,
        inspect: async (outcome) => {
          const judge = opts.judge
          const transport =
            judge && outcome.complete
              ? {
                  model: judge,
                  ...(opts.judgeFamily ? { family: opts.judgeFamily } : {}),
                  complete: (prompt: string) => outcome.complete!(judge, prompt),
                }
              : undefined
          const run = new Run(outcome, spec, transport, opts.family)
          // A crashed run fails whatever the assertions say, but they still run so the history
          // shows which expectations the crash broke.
          await assertions(run)
          if (opts.record && outcome.messages.length) {
            const slug = opts.model.replace(/[^a-zA-Z0-9]+/g, "-")
            ScriptedProvider.save(ScriptedProvider.fromMessages(`${name}.${slug}`, opts.model, outcome.messages))
          }
          return run
        },
      })
      report(name, opts, run)
    },
    budget + 60_000,
  )
}

function report(name: string, opts: Options, run: Run) {
  const { record } = run
  if (opts.pilot) {
    const estimate = run.outcome.estimate
    EvalHistory.append(EvalOptions.pilotPath(opts.history), {
      runId: opts.runId,
      time: Date.now(),
      eval: name,
      model: opts.model,
      replay: record.outcome,
      estimate: estimate ?? null,
      ...(estimate ? {} : { reason: "no catalog pricing for this model" }),
    })
    return
  }
  const row = EvalHistory.row({ runId: opts.runId, record, assertions: run.results, commit: process.env.REDCODE_EVAL_COMMIT })
  EvalHistory.append(opts.history, row)
  const lines = [
    `[eval] ${name} · ${opts.model} · ${record.outcome}${record.reason ? ` (${record.reason})` : ""}`,
    `       ${record.steps} steps · ${record.tools.length} tool calls · ${EvalHistory.usd(record.cost)} · ${record.durationMs}ms`,
    format(run.results),
    ...(process.env.REDCODE_EVAL_VERBOSE
      ? record.tools.map(
          (call) =>
            `  · ${call.tool} ${call.status} ${JSON.stringify(call.input).slice(0, 160)} => ${(call.error ?? call.output ?? "").slice(0, 300)}`,
        )
      : []),
  ]
  if (!row.passed) throw new Error(lines.join("\n"))
  if (process.env.REDCODE_EVAL_VERBOSE) console.log(lines.join("\n"))
}

export type { Spec } from "./harness"
export type { Rubric } from "./judge"
