#!/usr/bin/env bun
/**
 * `bun run eval` — runs the eval suite and prints the summary.
 *
 *   bun run eval                         every eval, replayed against the scripted provider
 *   bun run eval --smoke                 the two-eval CI-safe smoke
 *   bun run eval multi-file plan         evals whose file name contains any of the words
 *   bun run eval --pilot --model openrouter/z-ai/glm-5.3-flash
 *                                        estimate what a live run would cost; calls nothing
 *   REDCODE_EVAL_LIVE=1 bun run eval --live --model a/b,c/d --budget 2
 *                                        real models, one bun test process per model
 *
 * Flags: --model <p/m>[,<p/m>] (repeatable) · --catalog <provider>[:count] · --live · --pilot
 * --hermetic · --baseline last|best|model:<p/m> · --budget <usd> · --judge <p/m> · --record
 * --history <file> · --catalog-file <models.json> · --verbose
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { EvalHistory } from "./lib/history"
import { EvalOptions, SCRIPTED_MODEL } from "./lib/options"
import { EvalPilot } from "./lib/pilot"
import { SCRIPTED_PRICING } from "./lib/pricing"

const SMOKE = ["failing-test-recovery", "mcp-tool-search"]
const EVALS = path.join(import.meta.dir, "evals")

export interface Args {
  models: string[]
  catalog?: string
  catalogFile?: string
  live: boolean
  pilot: boolean
  hermetic: boolean
  baseline?: string
  budget?: string
  judge?: string
  record: boolean
  history?: string
  smoke: boolean
  verbose: boolean
  names: string[]
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { models: [], live: false, pilot: false, hermetic: false, record: false, smoke: false, verbose: false, names: [] }
  const value = (i: number, flag: string) => {
    const next = argv[i + 1]
    if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value`)
    return next
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined]
    const take = () => inline ?? value(i++, flag)
    switch (flag) {
      case "--model":
        args.models.push(...take().split(",").map((item) => item.trim()).filter(Boolean))
        break
      case "--catalog":
        args.catalog = take()
        break
      case "--catalog-file":
        args.catalogFile = take()
        break
      case "--baseline":
        args.baseline = take()
        break
      case "--budget":
        args.budget = take()
        break
      case "--judge":
        args.judge = take()
        break
      case "--history":
        args.history = take()
        break
      case "--live":
      case "--pilot":
      case "--hermetic":
      case "--record":
      case "--smoke":
      case "--verbose":
        args[flag.slice(2) as "live" | "pilot" | "hermetic" | "record" | "smoke" | "verbose"] = true
        break
      default:
        if (arg.startsWith("--")) throw new Error(`unknown flag ${arg}`)
        args.names.push(arg)
    }
  }
  return args
}

export function selectFiles(all: readonly string[], args: Pick<Args, "smoke" | "names">) {
  const names = args.smoke ? SMOKE : args.names
  if (!names.length) return [...all]
  return all.filter((file) => names.some((name) => path.basename(file).includes(name)))
}

function loadCatalog(file: string | undefined) {
  const candidates = [
    file,
    process.env.REDCODE_MODELS_PATH,
    path.join(os.homedir(), ".red", "code", "cache", "models.json"),
  ].filter((item): item is string => !!item)
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue
    return { file: candidate, catalog: JSON.parse(fs.readFileSync(candidate, "utf8")) as unknown }
  }
  return undefined
}

function git(...argv: string[]) {
  const out = Bun.spawnSync(["git", ...argv], { cwd: import.meta.dir, stdout: "pipe", stderr: "ignore" })
  return out.exitCode === 0 ? out.stdout.toString().trim() : undefined
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const envLive = process.env.REDCODE_EVAL_LIVE === "1"
  if (args.live && !envLive) throw new Error("--live calls real providers: also set REDCODE_EVAL_LIVE=1 and provider credentials")
  const live = args.live || envLive
  if (live && args.pilot) throw new Error("--pilot never calls a model; drop --live to estimate")
  const found = loadCatalog(args.catalogFile)
  let models = [...args.models]
  if (args.catalog) {
    if (!found) throw new Error("--catalog needs a models catalog: pass --catalog-file or run redcode once to cache one")
    const [provider, count] = args.catalog.split(":")
    models.push(...EvalPilot.catalogModels(found.catalog, provider!, count ? Number(count) : undefined))
  }
  if (!models.length) models = [SCRIPTED_MODEL]
  if (!live && !args.pilot && models.some((model) => model !== SCRIPTED_MODEL))
    throw new Error("real models run only with --live (and REDCODE_EVAL_LIVE=1), or --pilot to estimate cost")

  const files = selectFiles(
    fs
      .readdirSync(EVALS)
      .filter((file) => file.endsWith(".eval.ts"))
      .sort()
      .map((file) => path.join(EVALS, file)),
    args,
  )
  if (!files.length) throw new Error(`no eval matches ${args.names.join(", ")}`)

  const runId = `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)}-${Math.random().toString(36).slice(2, 8)}`
  const history = path.resolve(args.history ?? EvalOptions.defaultHistory(process.env.INIT_CWD ?? process.cwd()))
  const commit = git("rev-parse", "HEAD")
  let failed = 0

  for (const model of models) {
    const catalogEntry = found ? EvalPilot.lookup(found.catalog, model) : undefined
    const pricing = model === SCRIPTED_MODEL ? SCRIPTED_PRICING : catalogEntry?.pricing
    const judgeEntry = args.judge && found ? EvalPilot.lookup(found.catalog, args.judge) : undefined
    const env: Record<string, string | undefined> = {
      ...process.env,
      REDCODE_NO_BROWSER: "1",
      REDCODE_EVAL_MODEL: model,
      REDCODE_EVAL_RUN_ID: runId,
      REDCODE_EVAL_HISTORY: history,
      REDCODE_EVAL_LIVE: live ? "1" : undefined,
      REDCODE_EVAL_PILOT: args.pilot ? "1" : undefined,
      REDCODE_EVAL_HERMETIC: args.hermetic ? "1" : undefined,
      REDCODE_EVAL_BUDGET_USD: args.budget,
      REDCODE_EVAL_JUDGE: args.judge,
      REDCODE_EVAL_JUDGE_FAMILY: judgeEntry?.family,
      REDCODE_EVAL_FAMILY: catalogEntry?.family,
      REDCODE_EVAL_PRICING: pricing ? JSON.stringify(pricing) : undefined,
      REDCODE_EVAL_RECORD: args.record ? "1" : undefined,
      REDCODE_EVAL_COMMIT: commit,
      REDCODE_EVAL_VERBOSE: args.verbose ? "1" : undefined,
    }
    // Fail before spawning anything: a live run without a budget must never start.
    EvalOptions.parse(env)
    console.log(`\n[eval] ${model} · ${args.pilot ? "pilot" : live ? "live" : "scripted"} · ${files.length} evals · run ${runId}`)
    const proc = Bun.spawn(
      [process.execPath, "test", "--timeout", "600000", ...files.map((file) => `./${path.relative(import.meta.dir, file)}`)],
      { cwd: import.meta.dir, env: Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as Record<string, string>, stdio: ["inherit", "inherit", "inherit"] },
    )
    if ((await proc.exited) !== 0) failed++
  }

  if (args.pilot) {
    const rows = EvalHistory.read<{ runId: string; eval: string; model: string; estimate: EvalPilot.Estimate | null }>(
      EvalOptions.pilotPath(history),
    ).filter((row) => row.runId === runId)
    console.log(
      "\n" +
        EvalHistory.table(
          ["eval", "model", "requests", "input tok", "output tok", "estimate"],
          rows.map((row) => [
            row.eval,
            row.model,
            String(row.estimate?.requests ?? "-"),
            String(row.estimate?.inputTokens ?? "-"),
            String(row.estimate?.outputTokens ?? "-"),
            row.estimate ? EvalHistory.usd(row.estimate.usd) : "no pricing",
          ]),
        ),
    )
    const total = rows.reduce((sum, row) => sum + (row.estimate?.usd ?? 0), 0)
    const budget = args.budget ? Number(args.budget) : undefined
    console.log(`\nestimated total ${EvalHistory.usd(total)}${budget ? ` against a budget of ${EvalHistory.usd(budget)}` : ""}`)
    if (budget !== undefined && total > budget) console.log("warning: the estimate is over the budget")
    return failed ? 1 : 0
  }

  const all = EvalHistory.read(history)
  const current = all.filter((row) => row.runId === runId)
  console.log(`\n${EvalHistory.formatSummary(EvalHistory.summarize(current))}`)
  const baseline = EvalHistory.parseBaseline(args.baseline)
  if (baseline) {
    const comparisons = current.map((row) => EvalHistory.compare(row, EvalHistory.baselineFor(all, row, baseline)))
    console.log(`\n${EvalHistory.formatComparisons(comparisons)}`)
    if (comparisons.some((item) => item.regression)) failed++
  }
  console.log(`\nhistory: ${history}`)
  return failed ? 1 : 0
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`[eval] ${error instanceof Error ? error.message : String(error)}`)
      process.exit(2)
    },
  )
}
