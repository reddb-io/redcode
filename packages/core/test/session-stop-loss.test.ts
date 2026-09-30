import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Intelligence } from "@opencode/schema/intelligence"
import { SessionMessage } from "@opencode/core/session/message"
import { LoopGuard } from "@opencode/core/session/loop-guard"
import { LOOP_GUARD_REFUSAL } from "@opencode/core/session/loop-marker"
import { SessionStopLoss } from "@opencode/core/session/stop-loss"

const LIMITS = SessionStopLoss.limits(undefined, LoopGuard.LIMITS)!
// The ceiling is three times the no-progress threshold; the first probe is progress, the rest are not.
const PAST_CEILING = 3 * LIMITS.idleAt + 1
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
const signals = (steps: SessionStopLoss.Step[]) => SessionStopLoss.signals(observe(steps), LIMITS)
const read = call("read", { filePath: "a.ts" }, "a")

describe("SessionStopLoss.observe", () => {
  test("a result seen before is not progress, whatever the arguments were", () => {
    const trajectory = observe(probes(3))
    expect(trajectory).toMatchObject({ steps: 3, idle: 2, corrected: false })
    expect(trajectory.repeat).toMatchObject({ tool: "bash", count: 3, failed: false, identical: false })
  })

  test("an edit, a changed file, a completed task or a new result is progress", () => {
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
      step([read], { completed: 1_000 }),
      ...probes(3).map((item) => ({ ...item, tokens: 20_000, cost: 0.1, completed: 1_000 })),
    ]
    const trajectory = observe(steps, 61_000)
    expect(trajectory.idle).toBe(2)
    expect(trajectory.spent.tokens).toBe(40_000)
    expect(trajectory.spent.cost).toBeCloseTo(0.2)
    expect(trajectory.spent.ms).toBe(60_000)
  })

  test("a long failed build does not become time spent without progress", () => {
    const trajectory = observe(
      [
        step([read], { completed: 1_000 }),
        step([
          {
            ...call("bash", { command: "bun run build" }, "failed", "error"),
            time: { ran: 2_000, completed: 2_402_000 },
          },
        ]),
        step([]),
      ],
      2_403_000,
    )
    expect(trajectory.elapsed).toBe(2_402_000)
    expect(trajectory.spent.ms).toBe(2_000)
    expect(SessionStopLoss.signals(trajectory, LIMITS)).not.toContain("spend")
  })

  test("overlapping tools count once and only inside the period since progress", () => {
    const timed = (ran: number, completed: number) => ({
      ...call("bash", { command: "bun run build" }, "failed", "error"),
      time: { ran, completed },
    })
    const trajectory = observe(
      [
        step([read], { completed: 10_000 }),
        step([timed(5_000, 20_000), timed(15_000, 30_000), timed(40_000, 80_000)]),
        step([]),
      ],
      60_000,
    )
    expect(trajectory.elapsed).toBe(50_000)
    expect(trajectory.spent.ms).toBe(10_000)
  })

  test("history without tool timing still uses the wall clock", () => {
    const trajectory = observe([step([read]), step([]), step([])], 40 * 60_000)
    expect(trajectory.spent.ms).toBe(trajectory.elapsed)
    expect(SessionStopLoss.signals(trajectory, LIMITS)).toContain("spend")
  })

  test("projects execution timing from completed and failed V2 tools, not their creation time", () => {
    const message = Schema.decodeUnknownSync(SessionMessage.Assistant)({
      id: "msg_timed",
      type: "assistant",
      agent: "build",
      model: { providerID: "test", id: "model" },
      time: { created: 0, completed: 50_000 },
      content: [
        {
          type: "tool",
          id: "call_build",
          name: "bash",
          state: { status: "error", input: { command: "bun run build" }, error: { type: "test", message: "failed" } },
          time: { created: 1_000, ran: 10_000, completed: 30_000 },
        },
        {
          type: "tool",
          id: "call_read",
          name: "read",
          state: { status: "completed", input: {}, content: [{ type: "text", text: "ok" }] },
          time: { created: 2_000, ran: 20_000, completed: 40_000 },
        },
        {
          type: "tool",
          id: "call_refused",
          name: "bash",
          state: { status: "error", input: {}, error: { type: "test", message: "refused" } },
          time: { created: 0, completed: 50_000 },
        },
      ],
    })
    const baseline = Schema.decodeUnknownSync(SessionMessage.Assistant)({
      id: "msg_baseline",
      type: "assistant",
      agent: "build",
      model: { providerID: "test", id: "model" },
      time: { created: 0, completed: 0 },
      content: [
        {
          type: "tool",
          id: "call_baseline",
          name: "read",
          state: { status: "completed", input: {}, content: [{ type: "text", text: "ok" }] },
          time: { created: 0 },
        },
      ],
    })
    const turn = SessionStopLoss.projected([baseline, message])
    expect(turn.steps[1]?.parts.map((part) => part.time)).toEqual([
      { ran: 10_000, completed: 30_000 },
      { ran: 20_000, completed: 40_000 },
      undefined,
    ])
    expect(observe(turn.steps, 60_000).spent.ms).toBe(30_000)
  })
})

describe("SessionStopLoss.signals", () => {
  const cases: Array<[string, SessionStopLoss.Step[], SessionStopLoss.Signal[]]> = [
    ["one short of the repeat threshold is not yet a loop", probes(LIMITS.repeatAt - 1), []],
    ["the same result at the repeat threshold with drifting arguments", probes(LIMITS.repeatAt), ["same_result"]],
    [
      "identical calls at the repeat threshold, which the loop guard also sees",
      Array.from({ length: LIMITS.repeatAt }, () => step([call("bash", { command: "adb devices -l" }, DEVICES)])),
      ["same_result"],
    ],
    [
      "the same error",
      Array.from({ length: LIMITS.repeatAt }, (_, index) =>
        step([call("read", { filePath: `${index}` }, "EACCES", "error")]),
      ),
      ["same_error"],
    ],
    [
      "steps that only re-read what is already known",
      [
        step([call("read", { filePath: "a" }, "a"), call("read", { filePath: "b" }, "b")]),
        ...Array.from({ length: LIMITS.idleAt }, (_, index) =>
          step([index % 2 ? call("read", { filePath: "b" }, "b") : call("read", { filePath: "a" }, "a")]),
        ),
      ],
      ["no_progress"],
    ],
    ["spend while nothing moves", [step([read]), step([]), step([], { tokens: LIMITS.tokens })], ["spend"]],
    ["spend in a step that moved is not a loss", [step([read], { tokens: 900_000 })], []],
    [
      "task updates that keep failing",
      Array.from({ length: LIMITS.stopAt }, (_, index) =>
        step([call("todowrite", { todos: [] }, `refused ${index}`, "error")]),
      ),
      ["no_progress", "todo_failures"],
    ],
  ]
  test.each(cases)("%s", (_name, steps, expected) => {
    expect(signals(steps)).toEqual(expected)
  })

  test("a signal becomes severe at the loop guard's stop threshold, and the ceiling ends it regardless", () => {
    expect(SessionStopLoss.severe(observe(probes(LIMITS.stopAt - 1)), LIMITS)).toEqual([])
    expect(SessionStopLoss.severe(observe(probes(LIMITS.stopAt)), LIMITS)).toEqual(["same_result"])
    expect(SessionStopLoss.ceiling(observe(probes(PAST_CEILING - 1)), LIMITS)).toBe(false)
    expect(SessionStopLoss.ceiling(observe(probes(PAST_CEILING)), LIMITS)).toBe(true)
  })
})

describe("SessionStopLoss acknowledgements", () => {
  const ACK = "Edit applied successfully."
  const edit = (index: number) =>
    call("edit", { filePath: "index.html", oldString: `old ${index}`, newString: `new ${index}` }, ACK)
  const quiet = (command: string) => call("bash", { command }, "")

  test("six different edits answered with the same acknowledgement are work, not a repeated result", () => {
    // Shaped on a real trip: `same result from \`edit\` 6×` for six parallel edits of one file.
    const trajectory = observe([step([read]), step(Array.from({ length: 6 }, (_, index) => edit(index)))])
    expect(trajectory.repeat).toBeUndefined()
    expect(SessionStopLoss.signals(trajectory, LIMITS)).toEqual([])
  })

  test("edits interleaved with commands that print nothing are no signal either", () => {
    const steps = [
      step([read]),
      ...Array.from({ length: 4 }, (_, index) => step([edit(index), quiet(`git add part-${index}.ts`)])),
      step([quiet("mkdir -p dist"), quiet("git add -A"), quiet("cp a.ts dist/a.ts")]),
    ]
    expect(observe(steps).repeat).toBeUndefined()
    expect(signals(steps)).toEqual([])
  })

  test("task list updates answered the same are bookkeeping, not a loop", () => {
    const update = (index: number) =>
      call("todowrite", { todos: [{ content: `task ${index}`, status: "pending" }] }, "[]")
    expect(
      signals([step([read]), ...Array.from({ length: LIMITS.repeatAt }, (_, index) => step([update(index)]))]),
    ).toEqual([])
  })

  test("the same edit made again and again is still the loop guard's case", () => {
    const trajectory = observe(Array.from({ length: LIMITS.repeatAt }, () => step([edit(0)])))
    expect(trajectory.repeat).toMatchObject({ tool: "edit", count: LIMITS.repeatAt, identical: true })
    expect(SessionStopLoss.signals(trajectory, LIMITS)).toEqual(["same_result"])
  })

  test("failed repeats, read-only probes and silent failures keep counting", () => {
    const missed = Array.from({ length: LIMITS.repeatAt }, (_, index) =>
      step([call("edit", { filePath: `${index}.ts` }, "oldString not found", "error")]),
    )
    expect(signals([step([read]), ...missed])).toEqual(["same_error"])
    expect(signals(probes(LIMITS.repeatAt))).toEqual(["same_result"])
    // A search that finds nothing exits non-zero: its silence is an observation, not an acknowledgement.
    const search = (index: number): SessionStopLoss.Part => ({
      type: "tool",
      tool: "bash",
      state: { status: "completed", input: { command: `rg pattern-${index}` }, output: "", metadata: { exit: 1 } },
    })
    expect(
      signals([step([read]), ...Array.from({ length: LIMITS.repeatAt }, (_, index) => step([search(index)]))]),
    ).toEqual(["same_result"])
  })

  test("no-op Design edits remain a loop even when file paths and promises of a symlink change", () => {
    const trajectory = observe(
      Array.from({ length: LIMITS.stopAt }, (_, index) =>
        step([
          { type: "text", text: "I will fix the node_modules symlink now" },
          call(
            "edit",
            { path: `src/${index}.tsx`, oldString: "same", newString: "same" },
            "No changes to apply: oldString and newString are identical.",
            "error",
          ),
        ]),
      ),
    )
    expect(trajectory.repeat).toMatchObject({ tool: "edit", failed: true, identical: false, count: LIMITS.stopAt })
    expect(SessionStopLoss.severe(trajectory, LIMITS)).toContain("same_error")
  })
})

describe("SessionStopLoss spend", () => {
  // Every step re-sends a ~700k context, mostly cached, while adding a few thousand tokens to it.
  const large = (parts: SessionStopLoss.Part[], index: number) =>
    step(parts, { tokens: 2_000, context: 700_000 + index * 3_000, cost: 0.69 })
  // Steps that only think and answer: no progress, and nothing repeated for another signal to see.
  const idle = (count: number) => [
    large([read], 0),
    ...Array.from({ length: count }, (_, index) => large([], index + 1)),
  ]

  test("counts the work each step added, not the context it re-read", () => {
    const trajectory = observe(idle(2))
    expect(trajectory.idle).toBe(2)
    expect(trajectory.spent.tokens).toBe(2 * (2_000 + 3_000))
    expect(trajectory.spent.cost).toBeCloseTo(1.38)
    expect(trajectory.context).toBe(706_000)
    expect(SessionStopLoss.signals(trajectory, LIMITS)).toEqual([])
  })

  test("a provider's cache accounting flipping between steps is not new work", () => {
    // Shaped on a real trip, `no progress for 2 steps (~214k tokens, $0.03)`: a ~216k context reported
    // as cache reads on one step and as uncached input on another, with a step that reported no usage
    // in between. Compared with the step just before, the whole context looked new.
    const usage = (parts: SessionStopLoss.Part[], input: number, cached: number, cost: number) =>
      step(parts, { tokens: 1_200, context: input + cached, fresh: input, cost })
    const steps = [
      usage([read], 4_619, 211_328, 0.0013),
      step([], { tokens: 0, context: 0, fresh: 0, cost: 0 }),
      usage([], 209_957, 7_552, 0.0292),
    ]
    const trajectory = observe(steps)
    expect(trajectory.idle).toBe(2)
    expect(trajectory.spent.tokens).toBe(1_200 + (217_509 - 215_947))
    expect(SessionStopLoss.signals(trajectory, LIMITS)).toEqual([])
  })

  test("growth is never more than the step read uncached", () => {
    const steps = [
      step([read], { tokens: 0, context: 20_000, fresh: 20_000 }),
      step([], { tokens: 0, context: 220_000, fresh: 1_000 }),
    ]
    expect(observe(steps).spent.tokens).toBe(1_000)
  })

  test("tokens are spend only when what the steps cost agrees", () => {
    const heavy = (cost: number) => [
      step([read]),
      step([], { tokens: LIMITS.tokens * 0.75, cost: cost / 2 }),
      step([], { tokens: LIMITS.tokens * 0.75, cost: cost / 2 }),
    ]
    expect(signals(heavy(0.03))).toEqual([])
    expect(signals(heavy(0.5))).toEqual(["spend"])
    // A model that reports no cost is judged by its tokens alone.
    expect(signals(heavy(0))).toEqual(["spend"])
  })

  test("the spend thresholds grow with the context", () => {
    // Twice the threshold of new work in two steps is a signal at a small context, not at a 700k one.
    const heavy = (context: number) => [
      step([read], { context }),
      step([], { tokens: LIMITS.tokens, context }),
      step([], { tokens: LIMITS.tokens, context }),
    ]
    expect(signals(heavy(50_000))).toEqual(["spend"])
    expect(signals(heavy(700_000))).toEqual([])
  })

  test("spend alone ends the turn only after enough steps without progress", () => {
    const spent = (count: number) => [
      step([read]),
      ...Array.from({ length: count }, () => step([], { tokens: 400_000 })),
    ]
    expect(signals(spent(2))).toEqual(["spend"])
    expect(SessionStopLoss.severe(observe(spent(2)), LIMITS)).toEqual([])
    expect(SessionStopLoss.ceiling(observe(spent(2)), LIMITS)).toBe(false)
    expect(SessionStopLoss.severe(observe(spent(SessionStopLoss.SPEND_STOP_STEPS)), LIMITS)).toContain("spend")
    expect(
      SessionStopLoss.decide({
        trajectory: observe(spent(2)),
        limits: LIMITS,
        memory: { last: 1, steers: 1 },
        asked: false,
        subagent: false,
      }),
    ).toMatchObject({ action: "steer" })
  })
})

describe("SessionStopLoss.due", () => {
  const due = (step: number, last: number, found: SessionStopLoss.Signal[] = [], interval = true) =>
    SessionStopLoss.due({ step, memory: { last, steers: 0 }, limits: LIMITS, signals: found, interval })
  const cases: Array<[string, SessionStopLoss.Checkpoint, SessionStopLoss.Checkpoint]> = [
    ["before the interval", due(LIMITS.every - 1, 0), { type: "none" }],
    ["at the interval", due(LIMITS.every, 0), { type: "interval" }],
    ["no interval without S1", due(LIMITS.every, 0, [], false), { type: "none" }],
    [
      "the interval counts from the last checkpoint",
      due(LIMITS.every + LIMITS.cooldown, LIMITS.every),
      { type: "none" },
    ],
    [
      "a signal comes first, without repeats",
      due(2, 0, ["same_result", "no_progress", "same_result"]),
      { type: "signal", signals: ["same_result", "no_progress"] },
    ],
    ["once a step", due(5, 5, ["same_result"]), { type: "none" }],
    ["a signal waits out the cooldown", due(4 + LIMITS.cooldown - 1, 4, ["same_result"]), { type: "none" }],
    [
      "and is looked at after it",
      due(4 + LIMITS.cooldown, 4, ["same_result"]),
      { type: "signal", signals: ["same_result"] },
    ],
  ]
  test.each(cases)("%s", (_name, actual, expected) => {
    expect(actual).toEqual(expected)
  })
})

const STATES = ["progressing", "looping", "waiting", "wrong_approach"]
const ACTIONS = ["continue", "steer", "ask_user", "stop"]
/** A choice answer over `probabilities`, choosing the most probable label as Jev does. */
const choice = (probabilities: Record<string, number>) => ({
  type: "choice" as const,
  choice: Object.entries(probabilities).toSorted((left, right) => right[1] - left[1])[0]![0],
  confidence: 0.5,
  probabilities,
})
const sure = (label: string, labels: ReadonlyArray<string>) =>
  Object.fromEntries(labels.map((item) => [item, item === label ? 0.85 : 0.05]))
const s1 = (
  state: Record<string, number>,
  decision: Record<string, number>,
  verdict: Intelligence.Evaluation["decision"] = "accepted",
  issues: string[] = [],
) => ({ id: "evaluation-1", decision: verdict, answers: { state: choice(state), decision: choice(decision) }, issues })
const sureS1 = (state: string, decision: string) => s1(sure(state, STATES), sure(decision, ACTIONS))
// Unsure on both: the leads are well under the margin.
const unsure = s1(
  { looping: 0.31, progressing: 0.3, wrong_approach: 0.25, waiting: 0.14 },
  { steer: 0.4, stop: 0.36, continue: 0.09, ask_user: 0.15 },
  "inconclusive",
  ["state", "decision"],
)
const working = (count: number) =>
  Array.from({ length: count }, (_, index) => step([call("read", { filePath: `${index}.ts` }, `${index}`)]))

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
    expect(decide(probes(LIMITS.repeatAt), { asked: true, evaluation: sureS1("waiting", "ask_user") })).toEqual({
      action: "ask_user",
      state: "waiting",
      signals: ["same_result"],
      verified: true,
      evaluationID: "evaluation-1",
    })
  })

  test("a sure stop backed by a signal and a looping state ends the turn", () => {
    expect(decide(probes(LIMITS.stopAt), { asked: true, evaluation: sureS1("looping", "stop") })).toMatchObject({
      action: "stop",
      state: "looping",
      verified: true,
    })
  })

  test("S1 does not end a turn it reads as progressing, however sure the stop", () => {
    // Shaped on a real stop, `S1 · 30 steps this turn → stop`: progressing at 0.99 and stop at 0.86.
    const evaluation = s1(
      { progressing: 0.99, looping: 0, waiting: 0.01, wrong_approach: 0 },
      { stop: 0.86, continue: 0.13, ask_user: 0.01, steer: 0 },
    )
    expect(decide(working(30), { asked: true, evaluation })).toMatchObject({
      action: "continue",
      state: "progressing",
      verified: true,
    })
    // A sure progressing state is enough on its own, even when the decision is unsure.
    const progressing = s1(sure("progressing", STATES), { continue: 0.43, ask_user: 0.34, steer: 0.19, stop: 0.04 })
    expect(decide(probes(LIMITS.repeatAt), { asked: true, evaluation: progressing })).toMatchObject({
      action: "continue",
    })
  })

  test("without a signal behind it, S1's wish to end the turn is a hint at most", () => {
    const unsureState = { looping: 0.31, progressing: 0.3, wrong_approach: 0.25, waiting: 0.14 }
    const question = s1(unsureState, { ask_user: 0.55, steer: 0.27, continue: 0.16, stop: 0.02 })
    expect(decide(working(8), { asked: true, evaluation: question })).toMatchObject({ action: "continue" })
    expect(decide(working(8), { asked: true, evaluation: sureS1("looping", "stop") })).toMatchObject({
      action: "steer",
      verified: true,
    })
    // A steer needs a signal or a state that is not progress.
    expect(decide(working(8), { asked: true, evaluation: s1(unsureState, sure("steer", ACTIONS)) })).toMatchObject({
      action: "continue",
    })
    // A sure stop with a signal but no sure state is a hint too.
    expect(
      decide(probes(LIMITS.repeatAt), { asked: true, evaluation: s1(unsureState, sure("stop", ACTIONS)) }),
    ).toMatchObject({
      action: "steer",
      verified: true,
    })
  })

  test("an unsure S1 falls back to the mechanical rules and is never harsher than no S1", () => {
    expect(decide(probes(LIMITS.repeatAt), { asked: true, evaluation: unsure })).toEqual({
      action: "steer",
      signals: ["same_result"],
      verified: false,
      unavailable: "System One was unsure (state, decision)",
      evaluationID: "evaluation-1",
    })
    for (const [steps, memory] of [
      [probes(LIMITS.repeatAt), SessionStopLoss.FRESH],
      [probes(LIMITS.stopAt), { last: LIMITS.repeatAt, steers: 1 }],
      [probes(LIMITS.stopAt), { last: LIMITS.repeatAt, steers: SessionStopLoss.MAX_STEERS }],
      [working(8), SessionStopLoss.FRESH],
    ] as const)
      expect(decide([...steps], { asked: true, evaluation: unsure, memory }).action).toBe(
        decide([...steps], { memory }).action,
      )
  })

  test("single: a hint on each signal up to the cap, and a stop only after all of them", () => {
    const last = LIMITS.repeatAt
    expect(decide(probes(LIMITS.repeatAt))).toMatchObject({ action: "steer", verified: false })
    expect(decide(probes(LIMITS.repeatAt + 1), { memory: { last, steers: 1 } })).toMatchObject({ action: "steer" })
    expect(decide(probes(LIMITS.stopAt), { memory: { last, steers: SessionStopLoss.MAX_STEERS - 1 } })).toMatchObject({
      action: "steer",
    })
    expect(decide(probes(LIMITS.stopAt), { memory: { last, steers: SessionStopLoss.MAX_STEERS } })).toMatchObject({
      action: "stop",
      verified: false,
    })
    // Severe without the hints first still gets a hint.
    expect(decide(probes(LIMITS.stopAt))).toMatchObject({ action: "steer" })
  })

  test("leaves the hint to the loop guard when it has just corrected the model", () => {
    const refusal = call(
      "bash",
      { command: "adb devices -l" },
      `${LOOP_GUARD_REFUSAL}${LIMITS.repeatAt} of \`bash\``,
      "error",
    )
    const same = call("bash", { command: "adb devices -l" }, DEVICES)
    const steps = [...Array.from({ length: LIMITS.repeatAt - 1 }, () => step([same])), step([refusal])]
    expect(SessionStopLoss.signals(observe(steps), LIMITS)).toEqual(["same_result"])
    expect(decide(steps)).toMatchObject({ action: "continue" })
  })

  test("caps the hints a turn gets", () => {
    const capped = { memory: { last: 6, steers: SessionStopLoss.MAX_STEERS }, asked: true }
    expect(decide(probes(LIMITS.stopAt - 1), { ...capped, evaluation: sureS1("looping", "steer") })).toMatchObject({
      action: "continue",
    })
    expect(decide(probes(LIMITS.stopAt), { ...capped, evaluation: sureS1("waiting", "steer") })).toMatchObject({
      action: "ask_user",
    })
    expect(decide(probes(LIMITS.stopAt), { ...capped, evaluation: sureS1("looping", "steer") })).toMatchObject({
      action: "stop",
    })
    expect(decide(probes(LIMITS.stopAt), { memory: capped.memory })).toMatchObject({ action: "stop" })
  })

  test("fails open to the mechanical rules when S1 cannot answer, and says so", () => {
    expect(decide(probes(LIMITS.repeatAt), { asked: true })).toEqual({
      action: "steer",
      signals: ["same_result"],
      verified: false,
      unavailable: "System One did not answer",
    })
    expect(
      decide(probes(LIMITS.repeatAt), {
        asked: true,
        evaluation: {
          ...sureS1("waiting", "ask_user"),
          decision: "unavailable",
          issues: ["S1 timed out. Previous state preserved."],
        },
      }),
    ).toMatchObject({ action: "steer", verified: false, unavailable: "S1 timed out." })
  })

  test("ends the turn past the ceiling whatever S1 says", () => {
    const past = probes(PAST_CEILING)
    expect(decide(past, { asked: true, evaluation: sureS1("progressing", "continue") })).toMatchObject({
      action: "stop",
      verified: true,
    })
    expect(decide(past, { asked: true, evaluation: sureS1("waiting", "continue") })).toMatchObject({
      action: "ask_user",
    })
  })

  test("a subagent has no user to ask: its question ends its run and goes to the parent", () => {
    expect(
      decide(probes(LIMITS.repeatAt), { asked: true, subagent: true, evaluation: sureS1("waiting", "ask_user") }),
    ).toMatchObject({ action: "stop", state: "waiting" })
  })

  test("remembers the checkpoint and counts the hints", () => {
    const steer = decide(probes(LIMITS.repeatAt))
    expect(SessionStopLoss.remember(SessionStopLoss.FRESH, 3, steer)).toEqual({ last: 3, steers: 1 })
    expect(SessionStopLoss.remember({ last: 3, steers: 1 }, 6, { ...steer, action: "continue" })).toEqual({
      last: 6,
      steers: 1,
    })
  })
})

describe("SessionStopLoss.answer", () => {
  test("reads each answer on its own lead, whatever the evaluation's overall decision", () => {
    const evaluation = s1(
      { progressing: 0.58, wrong_approach: 0.31, waiting: 0.01, looping: 0.1 },
      { continue: 0.76, ask_user: 0.14, steer: 0.09, stop: 0.01 },
      "inconclusive",
      ["state"],
    )
    const reading = SessionStopLoss.answer(evaluation)
    expect(reading).toMatchObject({ action: "continue", state: "progressing" })
    expect(reading?.margin).toBeCloseTo(0.62)
    expect(SessionStopLoss.answer(unsure)).toEqual({})
    expect(SessionStopLoss.answer({ ...unsure, decision: "unavailable" })).toBeUndefined()
  })
})

describe("SessionStopLoss wording", () => {
  const trajectory: SessionStopLoss.Trajectory = {
    steps: 10,
    elapsed: 60_000,
    idle: 9,
    todoFailures: 0,
    spent: { tokens: 40_000, cost: 0, ms: 60_000 },
    corrected: false,
  }

  test("the compact line says what was seen, what it cost and what it waits on", () => {
    expect(
      SessionStopLoss.line(trajectory, {
        action: "ask_user",
        state: "waiting",
        signals: ["no_progress"],
        verified: true,
      }),
    ).toBe("S1 · no progress for 9 steps (~40k tokens) · waiting on you")
    // The mechanical rules are the stop-loss itself, not a lesser verdict.
    expect(SessionStopLoss.line(trajectory, { action: "steer", signals: ["no_progress"], verified: false })).toBe(
      "Stop-loss · no progress for 9 steps (~40k tokens)",
    )
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
    const input = SessionStopLoss.evaluation({
      sessionID: "ses_stop_loss",
      request: { id: "msg_request", text: "Install the app on my phone" },
      steps,
      trajectory: observe(steps),
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
})

describe("SessionStopLoss waiting on an outside job", () => {
  const RUN = "gh run view 42 --json status,conclusion"
  const PENDING = '{"conclusion":"","status":"in_progress"}'
  const poll: SessionStopLoss.Part = {
    type: "tool",
    tool: "bash",
    state: { status: "completed", input: { command: RUN, workdir: "/repo" }, output: PENDING, metadata: { exit: 0 } },
  }

  test("the same answer from a read-only status check of something outside is polling, not a loop", () => {
    const trajectory = observe(Array.from({ length: 2 }, () => step([poll])))
    expect(trajectory.repeat).toMatchObject({ tool: "bash", count: 2, probe: RUN })
    expect(SessionStopLoss.signals(trajectory, LIMITS)).toEqual(["polling"])
  })

  test("the external wait budget includes time inside a status-check tool", () => {
    const waited = LIMITS.wait * 60_000
    const steps = [step([poll], { completed: 0 }), step([{ ...poll, time: { ran: 0, completed: waited } }])]
    const trajectory = observe(steps, waited)
    expect(trajectory.spent.ms).toBe(0)
    expect(trajectory.elapsed).toBe(waited)
    expect(SessionStopLoss.signals(trajectory, LIMITS)).toEqual(["waited"])
    expect(
      SessionStopLoss.evaluation({
        sessionID: "ses_wait",
        request: { text: "Wait for the CI job" },
        steps,
        trajectory,
        checkpoint: { type: "signal", signals: ["waited"] },
        subagent: false,
        limits: LIMITS,
      }).sources,
    ).toMatchObject({ observed: { elapsed_minutes: LIMITS.wait, spent_since_progress: { minutes: 0 } } })
    expect(
      SessionStopLoss.final(
        trajectory,
        { action: "ask_user", state: "waiting", signals: ["waited"], verified: false },
        { subagent: false },
      ),
    ).toContain(`for ${LIMITS.wait} minutes`)
  })
})

describe("SessionStopLoss guard log records", () => {
  const trajectory = observe(probes(LIMITS.repeatAt))
  const continued: SessionStopLoss.Verdict = {
    action: "continue",
    state: "progressing",
    signals: ["same_result"],
    verified: true,
  }

  test("a signal the turn was allowed to keep going through is recorded as dismissed", () => {
    const recorded = SessionStopLoss.dismissed(
      { type: "signal", signals: ["same_result", "no_progress"] },
      trajectory,
      continued,
    )
    expect(recorded?.subject).toBe("dismissed:same_result,no_progress")
    expect(recorded?.detail).toContain("→ continue")
  })

  test("an interval checkpoint, or a checkpoint that acted, records nothing as dismissed", () => {
    expect(SessionStopLoss.dismissed({ type: "interval" }, trajectory, continued)).toBeUndefined()
    expect(
      SessionStopLoss.dismissed({ type: "signal", signals: ["same_result"] }, trajectory, {
        ...continued,
        action: "steer",
      }),
    ).toBeUndefined()
  })

  test("the work moving after a hint is recorded once, when the hints are cleared", () => {
    const hinted = { last: 12, steers: 2 }
    const recorded = SessionStopLoss.outcome(hinted, { last: 12, steers: 0 }, 15, trajectory)
    expect(recorded?.subject).toBe(SessionStopLoss.PROGRESSED)
    expect(recorded?.detail).toContain("progress after 2 hints")
    expect(recorded?.detail).toContain("step 15, last checkpoint at step 12")
    expect(SessionStopLoss.outcome({ last: 12, steers: 1 }, { last: 12, steers: 0 }, 13, trajectory)?.detail).toContain(
      "1 hint;",
    )
  })

  test("no outcome without a hint, while the hints stand, or for a turn that started over", () => {
    expect(SessionStopLoss.outcome({ last: 12, steers: 0 }, { last: 12, steers: 0 }, 15, trajectory)).toBeUndefined()
    expect(SessionStopLoss.outcome({ last: 12, steers: 2 }, { last: 12, steers: 2 }, 15, trajectory)).toBeUndefined()
    expect(SessionStopLoss.outcome({ last: 12, steers: 2 }, SessionStopLoss.FRESH, 3, trajectory)).toBeUndefined()
  })
})
