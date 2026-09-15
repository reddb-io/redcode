/**
 * The record one eval run leaves behind, and how a run is judged to have ended.
 *
 * Everything here is pure: the harness gathers raw session messages, guard trips and provider
 * requests, and this module turns them into a record the assertions, the history and the summary
 * table read. Keeping it free of Effect services is what lets the framework tests pin the rules.
 */

export type Outcome = "completed" | "failed" | "crashed" | "unmeasured"
export type Mode = "scripted" | "live" | "pilot"

export interface ToolCall {
  readonly tool: string
  readonly callID: string
  readonly status: "pending" | "running" | "completed" | "error"
  readonly input: Record<string, unknown>
  readonly output?: string
  readonly error?: string
  readonly metadata?: Record<string, unknown>
  readonly agent?: string
  readonly durationMs?: number
}

export interface GuardEvent {
  /** Guard log names (`loop`, `stall`, `steps`, …) plus two read from tool results: `evidence`, `polling`. */
  readonly guard: string
  readonly action: "warn" | "correct" | "stop"
  readonly subject?: string
  readonly detail: string
}

export interface Usage {
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

export interface ProviderRequest {
  readonly index: number
  readonly bytes: number
  readonly tools: readonly string[]
  /** Which script step answered it; undefined for title requests and misses. */
  readonly step?: number
  readonly kind: "step" | "title" | "miss"
}

export interface Interaction {
  readonly kind: "question" | "permission"
  readonly subject: string
  readonly answer: string
}

export interface RunRecord {
  readonly eval: string
  readonly model: string
  readonly mode: Mode
  readonly hermetic: boolean
  readonly outcome: Outcome
  readonly reason?: string
  /** The last non-synthetic assistant text. */
  readonly text: string
  readonly texts: readonly string[]
  readonly tools: readonly ToolCall[]
  readonly usage: Usage
  /** USD from the session's usage accounting; null when the run is unmeasured, never a fake $0. */
  readonly cost: number | null
  readonly durationMs: number
  readonly steps: number
  readonly guards: readonly GuardEvent[]
  readonly interactions: readonly Interaction[]
  readonly agents: readonly string[]
  readonly requests: readonly ProviderRequest[]
  readonly monitors: readonly { readonly id: string; readonly status: string }[]
}

export const emptyUsage: Usage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

export function totalTokens(usage: Usage) {
  return usage.input + usage.output + usage.reasoning + usage.cacheRead + usage.cacheWrite
}

// Loose views of SessionV1.WithParts: the record must read old and new message shapes alike.
type LooseMessage = { info: Record<string, any>; parts: Record<string, any>[] }

export interface Transcript {
  readonly tools: ToolCall[]
  readonly texts: string[]
  readonly usage: Usage
  readonly cost: number
  readonly steps: number
  readonly agents: string[]
  /** Assistant errors other than an abort, by name and message. */
  readonly errors: string[]
  readonly aborted: boolean
  readonly guards: GuardEvent[]
}

const POLLING_REFUSAL = /^Not run: this command (waits by sleeping|watches a job|sleeps)/

export function transcript(messages: readonly LooseMessage[]): Transcript {
  const tools: ToolCall[] = []
  const texts: string[] = []
  const agents: string[] = []
  const errors: string[] = []
  const guards: GuardEvent[] = []
  let usage = { ...emptyUsage }
  let cost = 0
  let steps = 0
  let aborted = false
  for (const message of messages) {
    if (message.info.role !== "assistant") continue
    const agent = typeof message.info.agent === "string" ? message.info.agent : undefined
    if (agent && agents.at(-1) !== agent) agents.push(agent)
    const error = message.info.error
    if (error && typeof error === "object") {
      const name = String(error.name ?? "Error")
      if (name === "MessageAbortedError") aborted = true
      else errors.push(`${name}: ${String(error.data?.message ?? error.message ?? "")}`.trim())
    }
    for (const part of message.parts) {
      if (part.type === "step-finish") {
        steps++
        const t = part.tokens ?? {}
        usage = {
          input: usage.input + num(t.input),
          output: usage.output + num(t.output),
          reasoning: usage.reasoning + num(t.reasoning),
          cacheRead: usage.cacheRead + num(t.cache?.read),
          cacheWrite: usage.cacheWrite + num(t.cache?.write),
        }
        cost += num(part.cost)
        continue
      }
      if (part.type === "text" && !part.synthetic && typeof part.text === "string" && part.text.trim()) {
        texts.push(part.text)
        continue
      }
      if (part.type !== "tool") continue
      const state = part.state ?? {}
      const call: ToolCall = {
        tool: String(part.tool),
        callID: String(part.callID ?? ""),
        status: state.status ?? "pending",
        input: state.input && typeof state.input === "object" ? state.input : {},
        ...(typeof state.output === "string" ? { output: state.output } : {}),
        ...(typeof state.error === "string" ? { error: state.error } : {}),
        ...(state.metadata ? { metadata: state.metadata } : {}),
        ...(agent ? { agent } : {}),
        ...(state.time?.end && state.time?.start ? { durationMs: state.time.end - state.time.start } : {}),
      }
      tools.push(call)
      if (call.status !== "error" || !call.error) continue
      if (call.tool === "todowrite")
        guards.push({ guard: "evidence", action: "correct", subject: call.callID, detail: firstLine(call.error) })
      else if (POLLING_REFUSAL.test(stripErrorPrefix(call.error)))
        guards.push({ guard: "polling", action: "correct", subject: call.tool, detail: firstLine(call.error) })
    }
  }
  return { tools, texts, usage, cost, steps, agents, errors, aborted, guards }
}

export interface Classify {
  readonly transcript: Transcript
  /** A harness failure: the loop died, a fixture was missing, the script ran out. */
  readonly crash?: string
  readonly timedOut?: boolean
  readonly budgetExceeded?: boolean
  readonly guards: readonly GuardEvent[]
}

/**
 * Precedence: a crash is a failure of the run itself; a run that blew its time or cost budget
 * failed whatever it measured; a run that ended with nothing measured is unmeasured, not a $0
 * success; only a measured run can fail on guards or complete.
 */
export function classify(input: Classify): { outcome: Outcome; reason?: string } {
  if (input.crash) return { outcome: "crashed", reason: input.crash }
  if (input.transcript.errors.length) return { outcome: "crashed", reason: input.transcript.errors.at(-1) }
  if (input.timedOut) return { outcome: "failed", reason: "time budget exceeded" }
  if (input.budgetExceeded) return { outcome: "failed", reason: "cost budget exceeded" }
  if (input.transcript.steps === 0 || totalTokens(input.transcript.usage) === 0)
    return {
      outcome: "unmeasured",
      reason: input.transcript.steps === 0 ? "the model produced no step" : "the provider reported no usage",
    }
  const stop = input.guards.find((event) => event.action === "stop")
  if (stop) return { outcome: "failed", reason: `guard stop (${stop.guard}): ${stop.detail}` }
  if (input.transcript.aborted) return { outcome: "failed", reason: "the turn was aborted" }
  return { outcome: "completed" }
}

export function build(input: {
  eval: string
  model: string
  mode: Mode
  hermetic: boolean
  messages: readonly LooseMessage[]
  guards: readonly GuardEvent[]
  crash?: string
  timedOut?: boolean
  budgetExceeded?: boolean
  durationMs: number
  interactions?: readonly Interaction[]
  requests?: readonly ProviderRequest[]
  monitors?: readonly { id: string; status: string }[]
}): RunRecord {
  const t = transcript(input.messages)
  const guards = [...input.guards, ...t.guards]
  const { outcome, reason } = classify({
    transcript: t,
    crash: input.crash,
    timedOut: input.timedOut,
    budgetExceeded: input.budgetExceeded,
    guards,
  })
  return {
    eval: input.eval,
    model: input.model,
    mode: input.mode,
    hermetic: input.hermetic,
    outcome,
    ...(reason ? { reason } : {}),
    text: t.texts.at(-1) ?? "",
    texts: t.texts,
    tools: t.tools,
    usage: t.usage,
    // Whatever the outcome, no reported usage means no measured cost.
    cost: outcome === "unmeasured" || totalTokens(t.usage) === 0 ? null : t.cost,
    durationMs: input.durationMs,
    steps: t.steps,
    guards,
    interactions: input.interactions ?? [],
    agents: t.agents,
    requests: input.requests ?? [],
    monitors: input.monitors ?? [],
  }
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function stripErrorPrefix(text: string) {
  return text.replace(/^(Error: )+/, "")
}

function firstLine(text: string) {
  return stripErrorPrefix(text).split("\n")[0]!.slice(0, 300)
}

export * as EvalRecord from "./record"
