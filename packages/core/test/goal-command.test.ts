import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import { GoalCommand } from "../src/session/goal-command"
import { Intelligence } from "../src/intelligence"
import { tmpdir } from "./fixture/tmpdir"

describe("parsing /goal", () => {
  const cases: Array<[string, GoalCommand.Parsed]> = [
    ["", { type: "menu" }],
    ["   ", { type: "menu" }],
    ["pause", { type: "action", action: "pause", argument: "" }],
    ["resume", { type: "action", action: "resume", argument: "" }],
    ["drop", { type: "action", action: "drop", argument: "" }],
    ["status", { type: "action", action: "status", argument: "" }],
    ["Pause", { type: "action", action: "pause", argument: "" }],
    ["budget 5$", { type: "action", action: "budget", argument: "5$" }],
    ["budget $5", { type: "action", action: "budget", argument: "$5" }],
    ["budget 200k tokens", { type: "action", action: "budget", argument: "200k tokens" }],
    ["budget", { type: "action", action: "budget", argument: "" }],
    ["set", { type: "action", action: "set", argument: "" }],
    ["set drop support for Node 16", { type: "action", action: "set", argument: "drop support for Node 16" }],
    ["make the tests pass", { type: "text", text: "make the tests pass" }],
    // A control word followed by more text is an objective, never a control: nothing is discarded.
    ["drop support for Node 16", { type: "text", text: "drop support for Node 16" }],
    ["status page loads under a second", { type: "text", text: "status page loads under a second" }],
    ["pausa isso por enquanto", { type: "text", text: "pausa isso por enquanto" }],
  ]
  test.each(cases)("%p", (input, expected) => {
    expect(GoalCommand.parse(input)).toEqual(expected)
  })

  test("typed slash commands, including the retired /goal-* spellings", () => {
    expect(GoalCommand.slash("/goal")).toEqual({ type: "menu" })
    expect(GoalCommand.slash("/goal pause")).toEqual({ type: "action", action: "pause", argument: "" })
    expect(GoalCommand.slash("/goal fix the build\nverify: bun test")).toEqual({
      type: "text",
      text: "fix the build\nverify: bun test",
    })
    expect(GoalCommand.slash("/goal-pause")).toEqual({ type: "action", action: "pause", argument: "" })
    expect(GoalCommand.slash("/goal-resume")).toEqual({ type: "action", action: "resume", argument: "" })
    expect(GoalCommand.slash("/goal-drop")).toEqual({ type: "action", action: "drop", argument: "" })
    expect(GoalCommand.slash("/goal-status")).toEqual({ type: "action", action: "status", argument: "" })
    expect(GoalCommand.slash("/goal-budget $5")).toEqual({ type: "action", action: "budget", argument: "$5" })
    expect(GoalCommand.slash("/goal-budget")).toEqual({ type: "action", action: "budget", argument: "" })
    expect(GoalCommand.slash("/goal-set x")).toBeUndefined()
    expect(GoalCommand.slash("/goalie")).toBeUndefined()
    expect(GoalCommand.slash("/compact")).toBeUndefined()
    expect(GoalCommand.slash("set a goal")).toBeUndefined()
  })

  test("the menu offers what the goal's state allows, the likely next step first", () => {
    expect(GoalCommand.menu(undefined)).toEqual(["set"])
    expect(GoalCommand.menu("active")[0]).toBe("pause")
    expect(GoalCommand.menu("paused")[0]).toBe("resume")
    expect(GoalCommand.menu("blocked")[0]).toBe("resume")
    expect(GoalCommand.menu("done")).toEqual(["set", "status"])
    expect(GoalCommand.menu("active")).toContain("drop")
  })
})

describe("deciding on S1's reading", () => {
  const read = (choice: string, confidence: number, probabilities: Record<string, number> = { [choice]: confidence }) =>
    evaluationOf({ type: "choice", choice, confidence, probabilities })

  test("a confident control is acted on", () => {
    expect(GoalCommand.decide(read("pause", 0.9), "active")).toEqual({ action: "pause", options: [], confidence: 0.9 })
    expect(GoalCommand.decide(read("set", 0.75), undefined)).toMatchObject({ action: "set" })
  })

  test("dropping needs 0.85; below it the user chooses", () => {
    expect(GoalCommand.decide(read("drop", 0.9), "active")).toMatchObject({ action: "drop" })
    const unsure = GoalCommand.decide(read("drop", 0.8, { drop: 0.8, pause: 0.15, set: 0.05 }), "active")
    expect(unsure.action).toBeUndefined()
    expect(unsure.options).toEqual(["drop", "pause", "set"])
  })

  test("replacing a live goal needs 0.85; setting the first one does not", () => {
    expect(GoalCommand.decide(read("set", 0.8), "active").action).toBeUndefined()
    expect(GoalCommand.decide(read("set", 0.8), "paused").action).toBeUndefined()
    expect(GoalCommand.decide(read("set", 0.8), "done")).toMatchObject({ action: "set" })
    expect(GoalCommand.decide(read("set", 0.9), "active")).toMatchObject({ action: "set" })
  })

  test("low confidence asks with the top interpretations", () => {
    const low = GoalCommand.decide(read("pause", 0.5, { pause: 0.5, set: 0.4, status: 0.1 }), "active")
    expect(low).toEqual({ options: ["pause", "set", "status"], confidence: 0.5 })
  })

  test("no reading asks between a new goal and the control the state suggests", () => {
    expect(GoalCommand.decide(undefined, "active")).toEqual({ options: ["set", "pause"] })
    expect(GoalCommand.decide(undefined, "paused")).toEqual({ options: ["set", "resume"] })
    expect(GoalCommand.decide(undefined, undefined)).toEqual({ options: ["set"] })
    expect(GoalCommand.decide({ ...read("drop", 1), decision: "unavailable" }, "active").action).toBeUndefined()
    expect(GoalCommand.decide(read("launch", 1), "active").action).toBeUndefined()
  })
})

describe("resolving with System One", () => {
  test("explicit subcommands and the menu never call S1, even in dual reasoning", async () => {
    await using dir = await tmpdir()
    const calls: unknown[] = []
    const resolved = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* dual(dir.path, (body) => {
          calls.push(body)
          return reply("drop", 1)
        })
        const resolve = (text: string) =>
          GoalCommand.resolve({ text, mode: "dual", status: "active", classify: classify(service, text) })
        return [yield* resolve("pause"), yield* resolve("budget 5$"), yield* resolve("drop"), yield* resolve("")]
      }),
    )
    expect(calls).toEqual([])
    expect(resolved.map((item) => item.action)).toEqual(["pause", "budget", "drop", undefined])
    expect(resolved[3]!.options).toEqual(GoalCommand.menu("active"))
  })

  test("single reasoning sets free text as the goal without S1", async () => {
    const resolved = await Effect.runPromise(
      GoalCommand.resolve({
        text: "pausa isso por enquanto",
        mode: "single",
        status: "active",
        classify: Effect.die("S1 must not be called in single reasoning"),
      }),
    )
    expect(resolved).toEqual({ action: "set", options: [] })
  })

  test("free text in any language is classified by S1 and a confident control is acted on", async () => {
    await using dir = await tmpdir()
    const calls: Array<{ state: { sources: { request: string; goal: unknown } }; questions: Record<string, unknown> }> =
      []
    const resolved = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* dual(dir.path, (body) => {
          calls.push(body)
          return reply("pause", 0.93)
        })
        const text = "pausa isso por enquanto"
        return yield* GoalCommand.resolve({ text, mode: "dual", status: "active", classify: classify(service, text) })
      }),
    )
    expect(calls).toHaveLength(1)
    expect(Object.keys(calls[0]!.questions)).toEqual(["action"])
    expect(calls[0]!.state.sources.request).toBe("pausa isso por enquanto")
    expect(calls[0]!.state.sources.goal).toEqual({ status: "active", objective: "ship the settings form" })
    expect(resolved).toMatchObject({ action: "pause" })
  })

  test("an unsure drop is asked about, never taken", async () => {
    await using dir = await tmpdir()
    const resolved = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* dual(dir.path, () => reply("drop", 0.7, { drop: 0.7, pause: 0.3 }))
        const text = "para o objetivo"
        return yield* GoalCommand.resolve({ text, mode: "dual", status: "active", classify: classify(service, text) })
      }),
    )
    expect(resolved.action).toBeUndefined()
    expect(resolved.options.slice(0, 2)).toEqual(["drop", "pause"])
  })

  test("an S1 failure asks rather than guesses", async () => {
    await using dir = await tmpdir()
    const resolved = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* dual(dir.path, () => new Response("unavailable", { status: 503 }))
        const text = "whatever this means"
        return yield* GoalCommand.resolve({ text, mode: "dual", status: "active", classify: classify(service, text) })
      }),
    )
    expect(resolved).toEqual({ options: ["set", "pause"] })
  })
})

function evaluationOf(answer: Intelligence.Evaluation["answers"][string]): Intelligence.Evaluation {
  return {
    id: "eval_test",
    fingerprint: "test",
    sessionID: "ses_goal_command",
    operation: "goal_command",
    kind: "classification",
    policy: "test",
    decision: "accepted",
    model: "jev-test",
    answers: { action: answer },
    issues: [],
    created: 0,
    duration: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
  }
}

// S1 answers carry a full distribution; the rest of the mass goes to one other action.
function reply(
  choice: string,
  confidence: number,
  probabilities: Record<string, number> = { [choice]: confidence, [choice === "set" ? "pause" : "set"]: 1 - confidence },
) {
  return Response.json({
    model: "jev-test",
    answers: { action: { type: "choice", choice, probabilities, confidence } },
    usage: { input_tokens: 20, output_tokens: 2 },
  })
}

const credentials = {
  get: () => Effect.succeed(undefined),
  list: () => Effect.succeed([]),
  create: () => Effect.die("Credential creation not expected"),
}

const settings = {
  enabled: true,
  reasoning: "dual" as const,
  onboarding: "completed" as const,
  principal: { id: Model.ID.make("main"), providerID: Provider.ID.make("test") },
  evaluator: { transport: "typesafe" as const, baseURL: "https://api.typesafe.ai/v1", model: "jev-test" },
}

function dual(root: string, respond: (body: never) => Response) {
  return Effect.gen(function* () {
    const fetcher: typeof fetch = Object.assign(
      (_url: string | URL | Request, init?: RequestInit) =>
        Promise.resolve(respond(JSON.parse(String(init?.body ?? "{}")) as never)),
      { preconnect() {} },
    )
    const service = yield* Intelligence.make(root, credentials, fetcher)
    yield* service.save({ settings })
    return service
  })
}

function classify(service: Intelligence.Interface, text: string) {
  return service.evaluate(
    GoalCommand.evaluation({
      sessionID: "ses_goal_command",
      text,
      goal: { status: "active", objective: "ship the settings form" },
    }),
  )
}
