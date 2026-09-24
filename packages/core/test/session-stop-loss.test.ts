import { describe, expect, test } from "bun:test"
import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { LoopGuard } from "@reddb-io/redcode-core/session/loop-guard"
import { LOOP_GUARD_REFUSAL } from "@reddb-io/redcode-core/session/loop-marker"
import { SessionStopLoss } from "@reddb-io/redcode-core/session/stop-loss"

const LIMITS = SessionStopLoss.limits(undefined, LoopGuard.LIMITS)!
const DEVICES = "List of devices attached\n"

const call = (tool: string, input: unknown, output: string, status = "completed"): SessionStopLoss.Part => ({
  type: "tool",
  tool,
  state: { status, input, ...(status === "error" ? { error: output } : { output }) },
})
const step = (
  parts: SessionStopLoss.Part[],
  extra: Partial<Omit<SessionStopLoss.Step, "parts">> = {},
): SessionStopLoss.Step => ({ parts, tokens: 8000, cost: 0, ...extra })
// The loop that started this: the same probe with its quoting varied, while nobody plugs the phone in.
const probe = (index: number) =>
  call(
    "bash",
    { command: index % 2 ? "adb devices -l; lsusb | grep -i android" : "adb devices -l ; lsusb | grep -i google" },
    DEVICES,
  )
const probes = (count: number) => Array.from({ length: count }, (_, index) => step([probe(index)]))
const observe = (steps: SessionStopLoss.Step[], now = 0) => SessionStopLoss.observe(steps, { now, started: 0 })

describe("SessionStopLoss.limits", () => {
  test("is off only when configured off, and follows the loop guard's thresholds", () => {
    expect(SessionStopLoss.limits(false, LoopGuard.LIMITS)).toBeUndefined()
    expect(SessionStopLoss.limits(undefined, undefined)).toEqual(SessionStopLoss.LIMITS)
    expect(
      SessionStopLoss.limits({ every: 4, idle_at: 1 }, { ...LoopGuard.LIMITS, correctAt: 2, stopAt: 4 }),
    ).toMatchObject({ every: 4, idleAt: 2, repeatAt: 2, stopAt: 4 })
  })
})

describe("SessionStopLoss.observe", () => {
  test("a result seen before is not progress, whatever the arguments were", () => {
    const trajectory = observe(probes(3))
    expect(trajectory).toMatchObject({ steps: 3, idle: 2, corrected: false })
    expect(trajectory.repeat).toMatchObject({ tool: "bash", count: 3, failed: false, identical: false })
  })

  test("an edit, a changed file, a completed task or a new result is progress", () => {
    const read = call("read", { filePath: "a.ts" }, "a")
    const cases: Array<[string, SessionStopLoss.Step, number]> = [
      ["an edit", step([call("edit", { filePath: "a.ts" }, "ok")]), 0],
      ["a changed file", step([read], { changed: true }), 0],
      ["a new result", step([call("read", { filePath: "b.ts" }, "b")]), 0],
      ["a completed task", step([call("todowrite", { todos: [{ content: "x", status: "completed" }] }, "[]")]), 0],
      ["the same result again", step([read]), 1],
      ["a failure", step([call("edit", { filePath: "a.ts" }, "not found", "error")]), 1],
      ["a reshuffled task list", step([call("todowrite", { todos: [{ content: "y", status: "pending" }] }, "[1]")]), 1],
    ]
    for (const [name, last, idle] of cases) expect([name, observe([step([read]), last]).idle]).toEqual([name, idle])
  })

  test("the loop guard's refusals stay in the run and mark the step as corrected", () => {
    const same = call("edit", { filePath: "a.ts" }, "oldString not found", "error")
    const refusal = call("edit", { filePath: "a.ts" }, `${LOOP_GUARD_REFUSAL}3 of \`edit\``, "error")
    const trajectory = observe([step([same]), step([same]), step([refusal])])
    expect(trajectory.repeat).toMatchObject({ tool: "edit", count: 3, failed: true, result: "oldString not found" })
    expect(trajectory.corrected).toBe(true)
  })

  test("counts what was spent since the last progress", () => {
    const steps = [
      step([call("read", { filePath: "a.ts" }, "a")], { completed: 1_000 }),
      ...probes(3).map((item) => ({ ...item, tokens: 20_000, cost: 0.1, completed: 1_000 })),
    ]
    const trajectory = observe(steps, 61_000)
    expect(trajectory.idle).toBe(2)
    expect(trajectory.spent.tokens).toBe(40_000)
    expect(trajectory.spent.cost).toBeCloseTo(0.2)
    expect(trajectory.spent.ms).toBe(60_000)
  })
})

describe("SessionStopLoss.signals", () => {
  const cases: Array<[string, SessionStopLoss.Step[], SessionStopLoss.Signal[]]> = [
    ["two of the same result is not yet a loop", probes(2), []],
    ["three of the same result with drifting arguments", probes(3), ["same_result"]],
    [
      "three identical calls, which the loop guard also sees",
      Array.from({ length: 3 }, () => step([call("bash", { command: "adb devices -l" }, DEVICES)])),
      ["same_result"],
    ],
    [
      "the same error",
      Array.from({ length: 3 }, (_, index) => step([call("read", { filePath: `${index}` }, "EACCES", "error")])),
      ["same_error"],
    ],
    [
      "steps that only re-read what is already known",
      [
        step([call("read", { filePath: "a" }, "a"), call("read", { filePath: "b" }, "b")]),
        ...Array.from({ length: 5 }, (_, index) =>
          step([index % 2 ? call("read", { filePath: "b" }, "b") : call("read", { filePath: "a" }, "a")]),
        ),
      ],
      ["no_progress"],
    ],
    [
      "spend while nothing moves",
      [step([call("read", { filePath: "a" }, "a")]), step([]), step([], { tokens: 160_000 })],
      ["spend"],
    ],
    [
      "spend in a step that moved is not a loss",
      [step([call("read", { filePath: "a" }, "a")], { tokens: 900_000 })],
      [],
    ],
    [
      "task updates that keep failing",
      Array.from({ length: 5 }, (_, index) => step([call("todowrite", { todos: [] }, `refused ${index}`, "error")])),
      ["no_progress", "todo_failures"],
    ],
  ]
  test.each(cases)("%s", (_name, steps, expected) => {
    expect(SessionStopLoss.signals(observe(steps), LIMITS)).toEqual(expected)
  })

  test("a signal becomes severe at the loop guard's stop threshold, and the ceiling ends it regardless", () => {
    expect(SessionStopLoss.severe(observe(probes(4)), LIMITS)).toEqual([])
    expect(SessionStopLoss.severe(observe(probes(5)), LIMITS)).toEqual(["same_result"])
    expect(SessionStopLoss.ceiling(observe(probes(15)), LIMITS)).toBe(false)
    expect(SessionStopLoss.ceiling(observe(probes(16)), LIMITS)).toBe(true)
  })
})

describe("SessionStopLoss.due", () => {
  const due = (step: number, last: number, signals: SessionStopLoss.Signal[] = [], interval = true, every = 8) =>
    SessionStopLoss.due({ step, memory: { last, steers: 0 }, limits: { ...LIMITS, every }, signals, interval })
  const cases: Array<[string, SessionStopLoss.Checkpoint, SessionStopLoss.Checkpoint]> = [
    ["before the interval", due(7, 0), { type: "none" }],
    ["at the interval", due(8, 0), { type: "interval" }],
    ["no interval without S1", due(8, 0, [], false), { type: "none" }],
    ["the interval counts from the last checkpoint", due(12, 8), { type: "none" }],
    [
      "a signal comes first, without repeats",
      due(2, 0, ["same_result", "no_progress", "same_result"]),
      { type: "signal", signals: ["same_result", "no_progress"] },
    ],
    ["once a step", due(5, 5, ["same_result"]), { type: "none" }],
    ["a signal waits out the cooldown", due(6, 4, ["same_result"]), { type: "none" }],
    ["and is looked at after it", due(7, 4, ["same_result"]), { type: "signal", signals: ["same_result"] }],
    ["an interval of zero is off", due(50, 0, [], true, 0), { type: "none" }],
    ["an infinite interval is off", due(50, 0, [], true, Infinity), { type: "none" }],
  ]
  test.each(cases)("%s", (_name, actual, expected) => {
    expect(actual).toEqual(expected)
  })

  test("a turn that started over forgets its checkpoints", () => {
    expect(SessionStopLoss.current({ last: 9, steers: 2 }, 3)).toEqual(SessionStopLoss.FRESH)
    expect(SessionStopLoss.current({ last: 3, steers: 1 }, 5)).toEqual({ last: 3, steers: 1 })
  })
})

const choice = (value: string) => ({
  type: "choice" as const,
  choice: value,
  confidence: 0.9,
  probabilities: { [value]: 0.9, continue: 0.1 },
})
const s1 = (state: string, decision: string, verdict: Intelligence.Evaluation["decision"] = "accepted") => ({
  id: "evaluation-1",
  decision: verdict,
  answers: { state: choice(state), decision: choice(decision) },
  issues: [],
})

describe("SessionStopLoss.decide", () => {
  const decide = (
    steps: SessionStopLoss.Step[],
    input: Partial<Omit<Parameters<typeof SessionStopLoss.decide>[0], "trajectory" | "limits">> = {},
  ) =>
    SessionStopLoss.decide({
      trajectory: observe(steps),
      limits: LIMITS,
      memory: SessionStopLoss.FRESH,
      asked: false,
      subagent: false,
      ...input,
    })

  test("dual: S1 reads the repeated probe as waiting on the user and asks them", () => {
    expect(decide(probes(3), { asked: true, evaluation: s1("waiting", "ask_user") })).toEqual({
      action: "ask_user",
      state: "waiting",
      signals: ["same_result"],
      verified: true,
      evaluationID: "evaluation-1",
    })
  })

  test("single: a hint on the first signal, then a stop once it persists", () => {
    expect(decide(probes(3))).toMatchObject({ action: "steer", verified: false })
    expect(decide(probes(4), { memory: { last: 3, steers: 1 } })).toMatchObject({ action: "steer" })
    expect(decide(probes(6), { memory: { last: 3, steers: 1 } })).toMatchObject({ action: "stop", verified: false })
    // Severe without a hint first still gets the hint.
    expect(decide(probes(6))).toMatchObject({ action: "steer" })
  })

  test("leaves the hint to the loop guard when it has just corrected the model", () => {
    const refusal = call("bash", { command: "adb devices -l" }, `${LOOP_GUARD_REFUSAL}3 of \`bash\``, "error")
    const same = call("bash", { command: "adb devices -l" }, DEVICES)
    expect(decide([step([same]), step([same]), step([refusal])])).toMatchObject({ action: "continue" })
  })

  test("caps the hints a turn gets", () => {
    const capped = { memory: { last: 6, steers: SessionStopLoss.MAX_STEERS }, asked: true }
    expect(decide(probes(4), { ...capped, evaluation: s1("looping", "steer") })).toMatchObject({ action: "continue" })
    expect(decide(probes(9), { ...capped, evaluation: s1("waiting", "steer") })).toMatchObject({ action: "ask_user" })
    expect(decide(probes(9), { ...capped, evaluation: s1("looping", "steer") })).toMatchObject({ action: "stop" })
    expect(decide(probes(9), { memory: capped.memory })).toMatchObject({ action: "stop" })
  })

  test("fails open to the mechanical rules when S1 cannot answer, and says so", () => {
    expect(decide(probes(3), { asked: true })).toEqual({
      action: "steer",
      signals: ["same_result"],
      verified: false,
      unavailable: "System One did not answer",
    })
    expect(
      decide(probes(3), {
        asked: true,
        evaluation: {
          ...s1("waiting", "ask_user", "unavailable"),
          issues: ["S1 timed out. Previous state preserved."],
        },
      }),
    ).toMatchObject({ action: "steer", verified: false, unavailable: "S1 timed out." })
    // Not sure enough is not an answer either.
    expect(decide(probes(3), { asked: true, evaluation: s1("waiting", "ask_user", "inconclusive") })).toMatchObject({
      action: "steer",
      verified: false,
    })
  })

  test("ends the turn past the ceiling whatever S1 says", () => {
    expect(decide(probes(16), { asked: true, evaluation: s1("progressing", "continue") })).toMatchObject({
      action: "stop",
      verified: true,
    })
    expect(decide(probes(16), { asked: true, evaluation: s1("waiting", "continue") })).toMatchObject({
      action: "ask_user",
    })
  })

  test("a subagent has no user to ask: its question ends its run and goes to the parent", () => {
    expect(decide(probes(3), { asked: true, subagent: true, evaluation: s1("waiting", "ask_user") })).toMatchObject({
      action: "stop",
      state: "waiting",
    })
  })

  test("remembers the checkpoint and counts the hints", () => {
    const steer = decide(probes(3))
    expect(SessionStopLoss.remember(SessionStopLoss.FRESH, 3, steer)).toEqual({ last: 3, steers: 1 })
    expect(SessionStopLoss.remember({ last: 3, steers: 1 }, 6, { ...steer, action: "continue" })).toEqual({
      last: 6,
      steers: 1,
    })
  })
})

describe("SessionStopLoss wording", () => {
  const trajectory: SessionStopLoss.Trajectory = {
    steps: 10,
    idle: 9,
    todoFailures: 0,
    spent: { tokens: 40_000, cost: 0, ms: 60_000 },
    corrected: false,
  }

  test("the compact line says what was seen, what it cost and what it waits on", () => {
    const verdict: SessionStopLoss.Verdict = {
      action: "ask_user",
      state: "waiting",
      signals: ["no_progress"],
      verified: true,
    }
    expect(SessionStopLoss.line(trajectory, verdict)).toBe(
      "S1 · no progress for 9 steps (~40k tokens) · waiting on you",
    )
    expect(SessionStopLoss.line(trajectory, { action: "stop", signals: ["no_progress"], verified: false })).toBe(
      "Stop-loss (unverified) · no progress for 9 steps (~40k tokens)",
    )
  })

  test("a question quotes the probe and what keeps coming back", () => {
    const text = SessionStopLoss.final(
      observe(probes(3)),
      { action: "ask_user", state: "waiting", signals: ["same_result"], verified: true },
      { subagent: false },
    )
    expect(text).toStartWith("**S1 · no progress for 2 steps")
    expect(text).toContain("`adb devices -l ; lsusb | grep -i google` came back with the same result 3 times")
    expect(text).toContain("List of devices attached")
    expect(text).toContain("only you can change")
  })

  test("a stopped subagent hands its parent the reason", () => {
    const text = SessionStopLoss.final(
      observe(probes(6)),
      { action: "stop", state: "waiting", signals: ["same_result"], verified: true },
      { subagent: true },
    )
    expect(text).toContain("Stopped by the stop-loss before finishing: it is waiting on something outside the session")
    expect(text).toContain("waiting on an outside condition")
  })

  test("a steer opens with its marker and quotes the repeated result", () => {
    const text = SessionStopLoss.steer(observe(probes(3)), {
      action: "steer",
      signals: ["same_result"],
      verified: false,
    })
    expect(text).toStartWith(SessionStopLoss.STEER)
    expect(text).toContain("Your last 3 `bash` calls came back with the same result")
  })
})

describe("SessionStopLoss.evaluation", () => {
  test("asks session_progress about the request and a bounded digest of the trajectory", () => {
    const steps = probes(20)
    const trajectory = observe(steps)
    const input = SessionStopLoss.evaluation({
      sessionID: "ses_stop_loss",
      request: { id: "msg_request", text: "Install the app on my phone" },
      steps,
      trajectory,
      checkpoint: { type: "signal", signals: ["same_result"] },
      subagent: false,
      limits: LIMITS,
    })
    expect(input).toMatchObject({ operation: "session_progress", kind: "classification", subjectID: "msg_request" })
    const sources = input.sources as { trajectory: { content: string }; role: string }
    expect(JSON.parse(sources.trajectory.content)).toMatchObject({
      total: 20,
      omitted: 20 - SessionStopLoss.DIGEST_CALLS,
    })
    expect(sources.role).toBe("session")
  })

  test("a fake that picks the first choice lets the session continue", () => {
    const criteria = (id: string) => {
      const question = SessionStopLoss.questions[id]
      return question?.type === "choice" ? Object.keys(question.criteria) : []
    }
    expect(criteria("state")[0]).toBe("progressing")
    expect(criteria("decision")[0]).toBe("continue")
  })
})
