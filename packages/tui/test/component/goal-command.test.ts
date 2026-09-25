import { describe, expect, test } from "bun:test"
import { createRedcodeClient } from "@reddb-io/redcode-sdk/v2"
import { GoalCommand } from "@reddb-io/redcode-core/session/goal-command"
import { createGoalCommand, type GoalChoice } from "../../src/component/goal-command"
import { json } from "../fixture/tui-sdk"

const goal = {
  id: "goal_test",
  objective: "ship the settings form",
  contract: {},
  gates: [],
  status: "active",
  turns: { used: 2, max: 20 },
  judgeFailures: 0,
  created: 0,
  updated: 0,
}

/**
 * The command against a fake server: `routes` answers by path, every request is recorded, and the
 * question/menu answers come from `choose`.
 */
function harness(input: {
  reasoning: "single" | "dual"
  routes?: Record<string, unknown>
  choose?: (choice: GoalChoice) => GoalCommand.Action | undefined
}) {
  const requests: Array<{ method: string; path: string; body: unknown }> = []
  const asked: GoalChoice[] = []
  const budgets: string[] = []
  const toasts: string[] = []
  const fetcher: typeof fetch = Object.assign(
    async (request: string | URL | Request) => {
      if (!(request instanceof Request)) throw new Error("SDK must pass a request")
      const path = new URL(request.url).pathname
      const body = request.method === "GET" ? undefined : await request.json().catch(() => undefined)
      requests.push({ method: request.method, path, body })
      const route = `${request.method} ${path.replace(/^\/session\/ses_goal/, "")}`
      return json(input.routes && route in input.routes ? input.routes[route] : goal)
    },
    { preconnect: fetch.preconnect },
  )
  const command = createGoalCommand({
    client: () => createRedcodeClient({ baseUrl: "http://test", fetch: fetcher }),
    reasoning: () => input.reasoning,
    agent: () => "build",
    notify: (toast) => toasts.push(toast.message),
    choose: async (choice) => {
      asked.push(choice)
      return input.choose?.(choice)
    },
    objective: async () => undefined,
    budget: (sessionID) => budgets.push(sessionID),
    show: (_title, message) => toasts.push(message),
  })
  return {
    requests,
    asked,
    budgets,
    toasts,
    run: (text: string) => command.run("ses_goal", GoalCommand.slash(text) ?? GoalCommand.parse(text)),
    paths: () => requests.map((request) => `${request.method} ${request.path.replace(/^\/session\/ses_goal/, "")}`),
  }
}

describe("/goal in single reasoning", () => {
  const cases: Array<[string, string[], unknown?]> = [
    ["/goal pause", ["POST /goal/pause"]],
    ["/goal resume", ["POST /goal/resume"]],
    ["/goal drop", ["POST /goal/drop"]],
    ["/goal budget 5$", ["POST /goal/budget"], { max_cost_usd: 5 }],
    ["/goal budget 200k tokens", ["POST /goal/budget"], { max_tokens: 200_000 }],
    ["/goal status", ["GET /goal"]],
    ["/goal make the tests pass", ["POST /goal"], { text: "make the tests pass", agent: "build" }],
    ["/goal set pause the rollout", ["POST /goal"], { text: "pause the rollout", agent: "build" }],
    // Retired spellings keep working.
    ["/goal-pause", ["POST /goal/pause"]],
    ["/goal-resume", ["POST /goal/resume"]],
    ["/goal-drop", ["POST /goal/drop"]],
    ["/goal-budget $3", ["POST /goal/budget"], { max_cost_usd: 3 }],
  ]
  test.each(cases)("%p", async (text, paths, body) => {
    const app = harness({ reasoning: "single" })
    await app.run(text)
    expect(app.paths()).toEqual(paths)
    if (body !== undefined) expect(app.requests.at(-1)?.body).toEqual(body)
    expect(app.asked).toEqual([])
  })

  test("an unparsable budget is refused with a message, not sent", async () => {
    const app = harness({ reasoning: "single" })
    await app.run("/goal budget lots")
    expect(app.paths()).toEqual([])
    expect(app.toasts[0]).toContain("not understood")
  })

  test("a budget without an amount opens the budget dialog", async () => {
    const app = harness({ reasoning: "single" })
    await app.run("/goal budget")
    expect(app.budgets).toEqual(["ses_goal"])
  })

  test("/goal alone shows the status and the actions for the goal's state", async () => {
    const app = harness({ reasoning: "single", choose: () => "pause" })
    await app.run("/goal")
    expect(app.asked).toHaveLength(1)
    expect(app.asked[0]!.title).toContain("Goal active · turn 3/20")
    expect(app.asked[0]!.options.map((option) => option.value)).toEqual(GoalCommand.menu("active"))
    expect(app.paths()).toEqual(["GET /goal", "POST /goal/pause"])
  })

  test("/goal alone without a goal offers only setting one", async () => {
    const app = harness({ reasoning: "single", routes: { "GET /goal": null } })
    await app.run("/goal")
    expect(app.asked[0]!.title).toBe("No goal yet")
    expect(app.asked[0]!.options.map((option) => option.value)).toEqual(["set"])
  })
})

describe("/goal in dual reasoning", () => {
  test("an explicit subcommand never asks the server to classify", async () => {
    for (const text of ["/goal pause", "/goal drop", "/goal budget $5", "/goal-drop"]) {
      const app = harness({ reasoning: "dual" })
      await app.run(text)
      expect(app.paths().some((path) => path.endsWith("/goal/command"))).toBe(false)
    }
  })

  test("free text is classified and a confident reading acted on", async () => {
    const app = harness({
      reasoning: "dual",
      routes: { "POST /goal/command": { action: "pause", options: [], confidence: 0.93 } },
    })
    await app.run("/goal pausa isso por enquanto")
    expect(app.paths()).toEqual(["POST /goal/command", "POST /goal/pause"])
    expect(app.requests[0]!.body).toEqual({ text: "pausa isso por enquanto" })
    expect(app.asked).toEqual([])
  })

  test("a classified new goal is set from the whole text", async () => {
    const app = harness({
      reasoning: "dual",
      routes: { "POST /goal/command": { action: "set", options: [], confidence: 0.9 } },
    })
    await app.run("/goal fazer os testes passarem")
    expect(app.paths()).toEqual(["POST /goal/command", "POST /goal"])
    expect(app.requests[1]!.body).toEqual({ text: "fazer os testes passarem", agent: "build" })
  })

  test("a low-confidence reading asks, and a dismissed question drops nothing", async () => {
    const app = harness({
      reasoning: "dual",
      routes: { "POST /goal/command": { options: ["drop", "pause", "set"], confidence: 0.7 } },
    })
    await app.run("/goal para o objetivo")
    expect(app.asked).toHaveLength(1)
    expect(app.asked[0]!.title).toContain("70% sure")
    expect(app.asked[0]!.options.map((option) => option.title)).toEqual([
      GoalCommand.LABELS.drop,
      GoalCommand.LABELS.pause,
      GoalCommand.LABELS.set,
    ])
    expect(app.paths()).toEqual(["POST /goal/command"])
  })

  test("the user's answer is what runs", async () => {
    const app = harness({
      reasoning: "dual",
      routes: { "POST /goal/command": { options: ["drop", "pause"], confidence: 0.7 } },
      choose: () => "pause",
    })
    await app.run("/goal para o objetivo")
    expect(app.paths()).toEqual(["POST /goal/command", "POST /goal/pause"])
  })

  test("a failed classification asks instead of guessing", async () => {
    const app = harness({ reasoning: "dual", routes: { "POST /goal/command": null } })
    await app.run("/goal whatever this means")
    expect(app.asked).toHaveLength(1)
    expect(app.asked[0]!.title).toContain("could not read it")
    expect(app.asked[0]!.options.map((option) => option.value)).toEqual(["set"])
    expect(app.paths()).toEqual(["POST /goal/command"])
  })

  test("a classified budget in prose opens the budget dialog", async () => {
    const app = harness({
      reasoning: "dual",
      routes: { "POST /goal/command": { action: "budget", options: [], confidence: 0.9 } },
    })
    await app.run("/goal aumenta o orçamento")
    expect(app.budgets).toEqual(["ses_goal"])
    expect(app.paths()).toEqual(["POST /goal/command"])
  })
})
