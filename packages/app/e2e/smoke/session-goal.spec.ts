import { expect, test } from "@playwright/test"
import type { SessionsGoalOutput } from "@reddb-io/redcode-client"
import { fixture, pageMessages } from "../performance/timeline/session-timeline-stress.fixture"
import { installStressSessionTabs, stressSessionHref } from "../performance/timeline/timeline-test-helpers"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

for (const response of [
  { name: "missing plan data", endpoint: "plan", body: {} },
  { name: "malformed plan revision", endpoint: "plan", body: { data: [{}] } },
  { name: "malformed Goal", endpoint: "goal", body: { data: { status: "active" } } },
]) {
  test(`the session composer remains usable after ${response.name}`, async ({ page }) => {
    await mockOpenCodeServer(page, {
      protocol: "v2",
      sessions: fixture.sessions,
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      pageMessages,
    })
    await installStressSessionTabs(page)
    const endpoint = `/api/session/${fixture.sourceID}/${response.endpoint}`
    await page.route(`**${endpoint}`, (route) => route.fulfill({ json: response.body }))
    const received = page.waitForResponse((reply) => new URL(reply.url()).pathname === endpoint)
    await page.goto(stressSessionHref(fixture.sourceID))
    await received
    await expectSessionTitle(page, fixture.expected.sourceTitle)
    const composer = page.getByRole("textbox")
    await expect(composer).toBeEditable()
    await composer.fill("/goal")
    await composer.press("Enter")
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText("What does done look like?", { exact: true })).toBeVisible()
    const objective = dialog.getByRole("textbox")
    await expect(objective).toBeEditable()
    await objective.fill("Keep the current session usable")
    await expect(objective).toHaveValue("Keep the current session usable")
    await expect(page.locator('[data-component="session-goal-progress"]')).toHaveCount(0)
    await expect(page.locator('[data-component="session-plan-history"]')).toHaveCount(0)
  })
}

test("Goal controls preserve the objective, show evidence and recorded plan revisions", async ({ page }) => {
  let goal: NonNullable<SessionsGoalOutput> = {
    id: "goal_browser",
    sessionID: fixture.sourceID,
    revision: 1,
    objective: "Deliver the reviewed checkout",
    criteria: ["Checkout verified"],
    gates: ["bun test"],
    stopAfter: "build",
    executePlan: true,
    status: "active",
    reason: "Checking the checkout",
    turns: { used: 2, max: 3 },
    tokens: 420,
    reviews: 1,
    evidence: [{ path: "reports/checkout.md", hash: "a".repeat(64), bytes: 50 }],
    checks: [{ command: "bun test", exitCode: 0, output: "12 pass, 0 fail", at: 1 }],
    created: 1,
    updated: 1,
  }
  await mockOpenCodeServer(page, {
    protocol: "v2",
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })
  await installStressSessionTabs(page)
  await page.route(/\/api\/session\/[^/]+\/(goal(?:\/control)?|plan)$/, async (route) => {
    const url = new URL(route.request().url())
    const source = url.pathname.includes(fixture.sourceID)
    if (url.pathname.endsWith("/plan"))
      return route.fulfill({
        json: {
          data: source
            ? [
                {
                  sessionID: fixture.sourceID,
                  revision: "a".repeat(64),
                  path: "plan.md",
                  content: "Approved checkout implementation and browser verification",
                  status: "approved",
                  created: 1,
                },
                ...(goal.turns.max < 43
                  ? []
                  : [
                      {
                        sessionID: fixture.sourceID,
                        revision: "b".repeat(64),
                        path: "plan.md",
                        content: "New draft awaiting approval",
                        status: "ready",
                        created: 2,
                      },
                    ]),
              ]
            : [],
        },
      })
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON()
      goal = {
        ...goal,
        revision: goal.revision + 1,
        status: input.action === "pause" ? "paused" : input.action === "resume" ? "active" : goal.status,
        turns: { ...goal.turns, max: input.maxTurns ?? goal.turns.max },
      }
    }
    return route.fulfill({ json: { data: source ? goal : null } })
  })
  await page.goto(stressSessionHref(fixture.sourceID))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  const dock = page.locator('[data-component="session-goal-progress"]')
  await expect(dock).toContainText("Deliver the reviewed checkout")
  await dock.getByRole("button", { name: "Pause goal", exact: true }).click()
  await expect(dock).toContainText("Paused")
  await dock.getByRole("button", { name: "Add 20 provider turns", exact: true }).click()
  await expect(dock).toContainText("2/23")
  await dock.getByRole("button", { name: "Resume goal", exact: true }).click()
  await expect(dock.getByRole("button", { name: "Pause goal", exact: true })).toBeEnabled()
  await dock.getByText("Recorded evidence", { exact: true }).click()
  await expect(dock.getByText(/reports\/checkout.md/)).toBeVisible()
  await dock.getByText("Executed checks", { exact: true }).click()
  await expect(dock.getByText(/12 pass, 0 fail/)).toBeVisible()
  await page.getByText("Recorded plans", { exact: true }).click()
  await page.getByText(/Approved for execution · a{12}/).click()
  await expect(
    page.getByText("Approved checkout implementation and browser verification", { exact: true }),
  ).toBeVisible()
  await dock.getByRole("button", { name: "Add 20 provider turns", exact: true }).click()
  await expect(dock).toContainText("2/43")
  await expect(page.getByText(/Ready for review · b{12}/)).toBeVisible()
  await expect(
    page.getByText("Approved checkout implementation and browser verification", { exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: "e2e/test-results/goal-evidence.png" })
  await page.goto(stressSessionHref(fixture.targetID))
  await expectSessionTitle(page, fixture.expected.targetTitle)
  await expect(page.locator('[data-component="session-goal-progress"]')).toHaveCount(0)
  await expect(page.locator('[data-component="session-plan-history"]')).toHaveCount(0)
})

test("starting a Goal records explicit execution consent even when an older status read is pending", async ({
  page,
}) => {
  const pending = Promise.withResolvers<void>()
  let first = true
  let goal: SessionsGoalOutput = null
  const submissions: Record<string, unknown>[] = []
  await mockOpenCodeServer(page, {
    protocol: "v2",
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })
  await installStressSessionTabs(page)
  await page.route(/\/api\/session\/[^/]+\/(goal|plan)$/, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/plan")) return route.fulfill({ json: { data: [] } })
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON()
      submissions.push(input)
      goal = {
        id: "goal_created",
        sessionID: fixture.sourceID,
        revision: 1,
        objective: input.objective,
        criteria: [input.objective],
        gates: [],
        stopAfter: input.stopAfter,
        executePlan: input.executePlan,
        status: "active",
        reason: "Starting",
        turns: { used: 0, max: input.maxTurns },
        tokens: 0,
        reviews: 0,
        evidence: [],
        checks: [],
        created: 1,
        updated: 1,
      }
      return route.fulfill({ json: { data: goal } })
    }
    if (first) {
      first = false
      await pending.promise
      return route.fulfill({ json: { data: null } })
    }
    return route.fulfill({ json: { data: goal } })
  })
  try {
    await page.goto(stressSessionHref(fixture.sourceID))
    await expectSessionTitle(page, fixture.expected.sourceTitle)
    const composer = page.getByRole("textbox")
    await composer.fill("/goal")
    await composer.press("Enter")
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText("What does done look like?", { exact: true })).toBeVisible()
    await dialog.getByRole("textbox").fill("Implement the approved checkout")
    await dialog.getByLabel("Provider-turn limit", { exact: true }).fill("8")
    await dialog.getByRole("checkbox", { name: /Allow implementing/ }).check()
    await dialog.getByRole("button", { name: "Start", exact: true }).click()
    await expect(dialog).toBeHidden()
    pending.resolve()
    await expect(page.locator('[data-component="session-goal-progress"]')).toContainText(
      "Implement the approved checkout",
    )
    expect(submissions).toHaveLength(1)
    expect(submissions[0]).toMatchObject({
      objective: "Implement the approved checkout",
      agent: "build",
      maxTurns: 8,
      executePlan: true,
      stopAfter: "build",
    })
  } finally {
    pending.resolve()
  }
})
