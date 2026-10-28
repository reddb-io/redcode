import type { Page } from "@playwright/test"

export async function mockGoal(page: Page, input: { ambiguous?: boolean; failStart?: boolean } = {}) {
  const requests: { sessionID: string; path: string; body: Record<string, unknown> }[] = []
  let goal: Record<string, unknown> | null = null
  let failed = false
  await page.route(/\/api\/experimental\/session\/[^/]+\/goal(?:\/(?:control|command))?(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url())
    const match = /\/session\/([^/]+)\/goal(?:\/(control|command))?$/.exec(url.pathname)!
    const sessionID = decodeURIComponent(match[1]!)
    const path = match[2] ?? "goal"
    if (route.request().method() === "GET") return route.fulfill({ json: { data: goal } })
    const body = route.request().postDataJSON() as Record<string, unknown>
    requests.push({ sessionID, path, body })
    if (path === "command") {
      const text = String(body.text)
      if (input.ambiguous && text === "maybe stop this")
        return route.fulfill({ json: { data: { options: ["set", "pause"], confidence: 0.4 } } })
      const action = /^(pause|resume|drop|status|budget|set)(?:\s|$)/i.exec(text)?.[1]?.toLowerCase() ?? "set"
      return route.fulfill({ json: { data: { action, options: [] } } })
    }
    if (path === "control") {
      if (body.action === "drop") goal = null
      if (goal && body.action === "pause") goal = { ...goal, status: "paused", reason: "Paused" }
      if (goal && body.action === "resume") goal = { ...goal, status: "active", reason: "Running" }
      if (goal && body.action === "budget")
        goal = { ...goal, budget: { maxTokens: body.maxTokens }, turns: { used: 0, max: body.maxTurns ?? 40 } }
      return route.fulfill({ json: { data: goal } })
    }
    if (input.failStart && !failed) {
      failed = true
      return route.fulfill({ status: 400, json: { _tag: "InvalidRequestError", message: "Goal service unavailable" } })
    }
    goal = {
      id: "goal_fixture",
      sessionID,
      revision: 1,
      objective: body.objective,
      criteria: [],
      gates: [],
      stopAfter: "build",
      executePlan: false,
      status: "active",
      reason: "Running",
      turns: { used: 0, max: 40 },
      tokens: 0,
      reviews: 0,
      evidence: [],
      checks: [],
      created: 1,
      updated: 1,
    }
    return route.fulfill({ json: { data: goal } })
  })
  return { requests }
}
