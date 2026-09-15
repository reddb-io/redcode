import { describe, expect, test } from "bun:test"
import { EvalRecord } from "../lib/record"

const finish = (input: number, output: number, cost: number) => ({
  type: "step-finish",
  reason: "stop",
  cost,
  tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } },
})
const tool = (name: string, state: Record<string, unknown>) => ({ type: "tool", tool: name, callID: `c-${name}`, state })
const assistant = (parts: object[], info: Record<string, unknown> = {}) => ({
  info: { role: "assistant", agent: "build", ...info },
  parts,
})

const base = { eval: "e", model: "m", mode: "scripted" as const, hermetic: false, durationMs: 10, guards: [] }

describe("transcript", () => {
  test("sums usage and cost per step and keeps tool calls, texts and agents in order", () => {
    const t = EvalRecord.transcript([
      { info: { role: "user" }, parts: [{ type: "text", text: "go" }] },
      assistant([
        { type: "text", text: "first" },
        tool("bash", { status: "completed", input: { command: "ls" }, output: "a", time: { start: 1, end: 5 } }),
        finish(100, 10, 0.001),
      ], { agent: "plan" }),
      assistant([{ type: "text", text: "reminder", synthetic: true }, { type: "text", text: "done" }, finish(200, 20, 0.002)]),
    ])
    expect(t.steps).toBe(2)
    expect(t.usage).toMatchObject({ input: 300, output: 30 })
    expect(t.cost).toBeCloseTo(0.003)
    expect(t.texts).toEqual(["first", "done"])
    expect(t.agents).toEqual(["plan", "build"])
    expect(t.tools[0]).toMatchObject({ tool: "bash", status: "completed", output: "a", durationMs: 4 })
  })

  test("reads evidence refusals and sleep-loop refusals out of tool errors", () => {
    const t = EvalRecord.transcript([
      assistant([
        tool("todowrite", { status: "error", input: {}, error: "Error: Completion needs evidence\nCandidates: …" }),
        tool("bash", { status: "error", input: {}, error: "Not run: this command waits by sleeping in a polling loop, which would block the turn." }),
        tool("bash", { status: "error", input: {}, error: "exit 1" }),
      ]),
    ])
    expect(t.guards.map((event) => `${event.guard}:${event.action}`)).toEqual(["evidence:correct", "polling:correct"])
    expect(t.guards[0]!.detail).toBe("Completion needs evidence")
  })

  test("separates aborts from provider errors", () => {
    const t = EvalRecord.transcript([
      assistant([], { error: { name: "MessageAbortedError", data: { message: "aborted" } } }),
      assistant([], { error: { name: "APIError", data: { message: "invalid request" } } }),
    ])
    expect(t.aborted).toBe(true)
    expect(t.errors).toEqual(["APIError: invalid request"])
  })
})

describe("outcome", () => {
  const measured = [assistant([{ type: "text", text: "ok" }, finish(10, 5, 0.0001)])]

  test("a measured run without incidents completed and keeps its cost", () => {
    const record = EvalRecord.build({ ...base, messages: measured })
    expect(record.outcome).toBe("completed")
    expect(record.cost).toBeCloseTo(0.0001)
    expect(record.text).toBe("ok")
  })

  test("a harness crash is crashed, whatever the model did", () => {
    expect(EvalRecord.build({ ...base, messages: measured, crash: "the session loop died" })).toMatchObject({
      outcome: "crashed",
      reason: "the session loop died",
    })
  })

  test("a provider error ending the turn is crashed", () => {
    const record = EvalRecord.build({
      ...base,
      messages: [...measured, assistant([], { error: { name: "APIError", data: { message: "boom" } } })],
    })
    expect(record).toMatchObject({ outcome: "crashed", reason: "APIError: boom" })
  })

  test("a model that stops before reporting usage is unmeasured with a null cost, not $0", () => {
    const silent = EvalRecord.build({ ...base, messages: [assistant([{ type: "text", text: "hi" }, finish(0, 0, 0)])] })
    expect(silent).toMatchObject({ outcome: "unmeasured", cost: null, reason: "the provider reported no usage" })
    const empty = EvalRecord.build({ ...base, messages: [] })
    expect(empty).toMatchObject({ outcome: "unmeasured", cost: null, reason: "the model produced no step" })
  })

  test("a timed out run failed, and without usage its cost stays null", () => {
    expect(EvalRecord.build({ ...base, messages: [], timedOut: true })).toMatchObject({
      outcome: "failed",
      reason: "time budget exceeded",
      cost: null,
    })
    expect(EvalRecord.build({ ...base, messages: measured, budgetExceeded: true }).reason).toBe("cost budget exceeded")
  })

  test("a guard stop fails a measured run; corrections do not", () => {
    const stop = EvalRecord.build({
      ...base,
      messages: measured,
      guards: [{ guard: "loop", action: "stop", detail: "the same glob call repeated 5 times" }],
    })
    expect(stop).toMatchObject({ outcome: "failed", reason: "guard stop (loop): the same glob call repeated 5 times" })
    const correct = EvalRecord.build({ ...base, messages: measured, guards: [{ guard: "loop", action: "correct", detail: "x" }] })
    expect(correct.outcome).toBe("completed")
  })
})
