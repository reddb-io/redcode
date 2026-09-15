/**
 * Soft assertions over a run record. Each check records a result instead of throwing, so one
 * failed expectation does not hide the others and the history keeps the whole verdict.
 */
import fs from "node:fs"
import path from "node:path"
import type { RunRecord, ToolCall } from "./record"

export interface AssertionResult {
  readonly name: string
  readonly pass: boolean
  readonly message: string
}

export type Predicate = (input: Record<string, any>, call: ToolCall) => boolean
export type Matcher = string | RegExp

export interface CheckResult {
  readonly exitCode: number
  readonly output: string
}

export interface ExpectationsOptions {
  readonly workspace: string
  /** Runs a shell command in the workspace; injectable so the framework tests stay fast. */
  readonly exec?: (command: string, cwd: string, timeoutMs: number) => Promise<CheckResult>
}

export class Expectations {
  readonly results: AssertionResult[] = []

  constructor(
    readonly record: RunRecord,
    private readonly options: ExpectationsOptions,
  ) {}

  /** Records any custom verdict. */
  that(name: string, pass: boolean, message = pass ? "ok" : "failed") {
    this.results.push({ name, pass, message })
    return this
  }

  completed() {
    const { outcome, reason } = this.record
    return this.that("completed", outcome === "completed", outcome === "completed" ? "ok" : `${outcome}: ${reason ?? ""}`)
  }

  toolCalled(name: string, predicate?: Predicate, options: { times?: number; atLeast?: number; status?: ToolCall["status"] } = {}) {
    const calls = this.calls(name, predicate, options.status)
    const label = `toolCalled(${name}${predicate ? ", predicate" : ""}${options.status ? `, ${options.status}` : ""})`
    if (options.times !== undefined)
      return this.that(label, calls.length === options.times, `expected ${options.times} calls, saw ${calls.length}${this.seen()}`)
    const atLeast = options.atLeast ?? 1
    return this.that(label, calls.length >= atLeast, `expected at least ${atLeast} calls, saw ${calls.length}${this.seen()}`)
  }

  toolNotCalled(name: string, predicate?: Predicate) {
    const calls = this.calls(name, predicate)
    return this.that(
      `toolNotCalled(${name}${predicate ? ", predicate" : ""})`,
      calls.length === 0,
      calls.length ? `called ${calls.length} times: ${JSON.stringify(calls[0]!.input).slice(0, 200)}` : "ok",
    )
  }

  costAtMost(usd: number) {
    const { cost } = this.record
    if (cost === null) return this.that(`costAtMost(${usd})`, false, "unmeasured: the provider reported no usage")
    return this.that(`costAtMost(${usd})`, cost <= usd, `cost $${cost.toFixed(6)}`)
  }

  finishedWithin(ms: number) {
    return this.that(`finishedWithin(${ms})`, this.record.durationMs <= ms, `took ${this.record.durationMs}ms`)
  }

  stepsAtMost(steps: number) {
    return this.that(`stepsAtMost(${steps})`, this.record.steps <= steps, `took ${this.record.steps} steps`)
  }

  /** No guard stopped the run; with `strict`, no guard corrected or warned either. */
  noGuardStops(options: { strict?: boolean } = {}) {
    const hits = this.record.guards.filter((event) => options.strict || event.action === "stop")
    return this.that(
      options.strict ? "noGuardEvents" : "noGuardStops",
      hits.length === 0,
      hits.length ? hits.map((event) => `${event.guard}:${event.action} ${event.detail}`).join("; ").slice(0, 400) : "ok",
    )
  }

  guardFired(guard: string, action?: "warn" | "correct" | "stop") {
    const hit = this.record.guards.some((event) => event.guard === guard && (!action || event.action === action))
    return this.that(`guardFired(${guard}${action ? `, ${action}` : ""})`, hit, hit ? "ok" : "the guard never fired")
  }

  mentions(matcher: Matcher) {
    const found = test(matcher, this.record.text)
    return this.that(`mentions(${matcher})`, found, found ? "ok" : `final text: ${this.record.text.slice(0, 200)}`)
  }

  fileContains(file: string, matcher: Matcher) {
    const target = path.resolve(this.options.workspace, file)
    if (!fs.existsSync(target)) return this.that(`fileContains(${file})`, false, "file does not exist")
    const text = fs.readFileSync(target, "utf8")
    return this.that(`fileContains(${file}, ${matcher})`, test(matcher, text), `content: ${text.slice(0, 200)}`)
  }

  /** A workspace command exits 0. */
  async check(command: string, options: { timeoutMs?: number } = {}) {
    const exec = this.options.exec ?? shell
    const result = await exec(command, this.options.workspace, options.timeoutMs ?? 60_000)
    return this.that(
      `check(${command})`,
      result.exitCode === 0,
      result.exitCode === 0 ? "exit 0" : `exit ${result.exitCode}: ${result.output.slice(-300)}`,
    )
  }

  get failures() {
    return this.results.filter((item) => !item.pass)
  }

  private calls(name: string, predicate?: Predicate, status?: ToolCall["status"]) {
    return this.record.tools.filter(
      (call) => call.tool === name && (!status || call.status === status) && (!predicate || safe(predicate, call)),
    )
  }

  private seen() {
    const names = [...new Set(this.record.tools.map((call) => call.tool))]
    return names.length ? ` (tools used: ${names.join(", ")})` : " (no tools used)"
  }
}

export function format(results: readonly AssertionResult[]) {
  return results.map((item) => `${item.pass ? "ok  " : "FAIL"} ${item.name}: ${item.message}`).join("\n")
}

function test(matcher: Matcher, text: string) {
  return typeof matcher === "string" ? text.includes(matcher) : matcher.test(text)
}

function safe(predicate: Predicate, call: ToolCall) {
  try {
    return predicate(call.input, call)
  } catch {
    return false
  }
}

async function shell(command: string, cwd: string, timeoutMs: number): Promise<CheckResult> {
  const proc = Bun.spawn(["sh", "-c", command], { cwd, stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => proc.kill(), timeoutMs)
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timer)
  return { exitCode, output: stdout + stderr }
}

export * as EvalAssert from "./assert"
