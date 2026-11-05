import { expect, test, type Locator, type Page } from "@playwright/test"
import { seed, sessionHref, tabKey } from "../utils/app"
import { fileDiff, openSession } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"
import { fixture, installStressSessionTabs, mockStressTimeline } from "../utils/session-fixture"
import { mockAgentTasks } from "../utils/agent-task-fixture"
import {
  deliverySkills,
  mockDeliveryAutomations,
  mockDeliveryHooks,
  mockDeliveryMonitors,
  mockDeliveryNativeTasks,
  mockDeliveryResources,
} from "../utils/delivery-fixture"

test("delivery publishes session artifact revisions and previews HTML in a sandbox", async ({ page }) => {
  await page.setViewportSize({ width: 1560, height: 1000 })
  await seed(page, { theme: { id: "oc-2", scheme: "dark" } })
  await mockStressTimeline(page)
  await installStressSessionTabs(page)
  await mockAgentTasks(page)
  const artifact = {
    id: "art_123",
    sessionID: fixture.sourceID,
    title: "Report",
    created: 1,
    updated: 1,
    revisions: [
      {
        id: "rev_one",
        created: 1,
        entry: "index.html",
        files: { "index.html": "hash", "style.css": "hash2", "pixel.png": "hash3" },
      },
    ],
  }
  let items: (typeof artifact)[] = []
  const writes: unknown[] = []
  await page.route(`**/api/session/${fixture.sourceID}/artifact**`, async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON())
      items = [artifact]
      return route.fulfill({ json: { data: artifact } })
    }
    return route.fulfill({ json: { data: items } })
  })
  await page.route(`**/api/session/${fixture.sourceID}/artifact/*/*/content?*`, (route) => {
    const file = new URL(route.request().url()).searchParams.get("file")
    const contents: Record<string, string> = {
      "index.html":
        '<meta http-equiv="refresh" content="0;url=https://outside.invalid/"><link rel="stylesheet" href="style.css"><h1>Report body</h1><img alt="Local image" src="pixel.png"><script>document.body.dataset.executed="yes"</script>',
      "style.css": "h1 { color: rgb(1, 2, 3) }",
      "pixel.png": "pixel",
    }
    return route.fulfill({ json: { data: btoa(contents[file ?? ""] ?? "") } })
  })
  await page.goto(sessionHref(fixture.sourceID))
  await page.getByRole("button", { name: "Open delivery overview", exact: true }).click()
  const delivery = page.getByRole("region", { name: "Delivery", exact: true })
  await delivery.getByRole("tab", { name: "Artifacts", exact: true }).click()
  await delivery.getByLabel("Title", { exact: true }).fill("Report")
  await delivery.getByLabel("Workspace folder", { exact: true }).fill("reports/demo")
  await delivery.getByRole("button", { name: "Create artifact", exact: true }).click()
  await expect(delivery.getByRole("button", { name: "Report", exact: true })).toBeVisible()
  expect(writes).toEqual([{ source: "reports/demo", title: "Report", entry: "index.html" }])
  await delivery.getByRole("button", { name: "Report", exact: true }).click()
  const frame = delivery.locator('iframe[title="Artifact preview"]')
  await expect(frame).toHaveAttribute("sandbox", "")
  await expect(frame).not.toHaveAttribute("srcdoc", /outside\.invalid/)
  await expect(frame.contentFrame().getByRole("heading", { name: "Report body" })).toBeVisible()
  await expect(frame.contentFrame().getByRole("heading", { name: "Report body" })).toHaveCSS("color", "rgb(1, 2, 3)")
  await expect(frame.contentFrame().getByAltText("Local image")).toHaveAttribute("src", /^data:image\/png;base64,/)
  await expect(frame.contentFrame().locator("body")).not.toHaveAttribute("data-executed", "yes")
  await delivery.getByRole("button", { name: "Publish revision", exact: true }).click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1]).toMatchObject({ id: "art_123", expectedRevision: "rev_one" })
})

test("delivery explains when an older server does not support artifacts", async ({ page }) => {
  await page.setViewportSize({ width: 1560, height: 1000 })
  await seed(page, { theme: { id: "oc-2", scheme: "dark" } })
  await mockStressTimeline(page)
  await installStressSessionTabs(page)
  await mockAgentTasks(page)
  await page.route(`**/api/session/${fixture.sourceID}/artifact`, (route) =>
    route.fulfill({ status: 404, json: { message: "Not found" } }),
  )
  await page.goto(sessionHref(fixture.sourceID))
  await page.getByRole("button", { name: "Open delivery overview", exact: true }).click()
  const delivery = page.getByRole("region", { name: "Delivery", exact: true })
  await delivery.getByRole("tab", { name: "Artifacts", exact: true }).click()
  await expect(delivery.getByRole("alert")).toContainText("This server may not support them yet")
})

test("delivery follows the session family and preserves recorded task acceptance", async ({ page }) => {
  await page.setViewportSize({ width: 1560, height: 1000 })
  await seed(page, { theme: { id: "oc-2", scheme: "dark" } })
  await mockStressTimeline(page)
  await installStressSessionTabs(page)
  const mock = await mockAgentTasks(page)
  const reads: string[] = []
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (path.endsWith("/todo/graph") || path.endsWith("/goal")) reads.push(path)
  })
  await page.goto(sessionHref(mock.sessionID))
  const toggle = page.getByRole("button", { name: "Open delivery overview", exact: true })
  await expect(toggle).toBeEnabled()
  expect(reads).toEqual([])
  await toggle.click()
  const delivery = page.getByRole("region", { name: "Delivery", exact: true })
  await expect(delivery.getByText("Deliver a verified task workflow", { exact: true })).toBeVisible()
  await delivery.getByRole("button", { name: "Lineage graph", exact: true }).click()
  const lineage = delivery.locator('[data-graph-fallback="svg"]')
  await expect(lineage.locator(`[data-node-id="${fixture.sourceID}"]`)).toBeVisible()
  await expect(lineage.locator(`[data-node-id="${fixture.childID}"]`)).toBeVisible()
  await expect(lineage.locator("[data-graph-edge]")).toHaveCount(1)
  await expect(delivery.getByRole("progressbar", { name: "Task completion", exact: true })).toHaveAttribute(
    "aria-valuenow",
    "2",
  )
  await expect(delivery.getByRole("progressbar", { name: "Task completion", exact: true })).toHaveAttribute(
    "aria-valuemax",
    "3",
  )
  await delivery.getByRole("button", { name: "Flow", exact: true }).click()
  const flow = delivery.getByRole("group", { name: "Task dependencies", exact: true })
  await expect(flow).toBeVisible()
  await flow.getByRole("button", { name: /^Reconcile delegated results, Pending/ }).click()
  const task = delivery.getByRole("region", { name: "Task details", exact: true })
  await expect(task.getByRole("heading", { name: "Reconcile delegated results", exact: true })).toBeVisible()
  await expect(task.getByText("The combined candidate passes the project checks", { exact: true })).toBeVisible()
  const prerequisites = task.getByRole("list", { name: "Prerequisites", exact: true })
  await expect(prerequisites.getByRole("listitem")).toHaveCount(2)
  await expect(prerequisites.getByText("Prerequisite satisfied", { exact: true })).toHaveCount(2)
  mock.nodes[2].waitingFor = ["api"]
  mock.nodes[2].ready = false
  await delivery.getByRole("button", { name: "Refresh overview", exact: true }).click()
  await expect(prerequisites.getByRole("listitem").filter({ hasText: "Implement task API" })).toContainText(
    "Waiting for acceptance",
  )
  await expect(delivery.getByRole("progressbar", { name: "Task completion", exact: true })).toHaveAttribute(
    "aria-valuenow",
    "2",
  )
  await task.scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath("delivery-flow-desktop.png"), fullPage: true })
  await task.getByRole("button", { name: "Implement task API", exact: true }).click()
  await expect(task.getByRole("heading", { name: "Implement task API", exact: true })).toBeVisible()
  await expect(task.getByRole("button", { name: "Inspect child navigation", exact: true })).toBeEnabled()
  await delivery.getByRole("button", { name: "List", exact: true }).click()
  await expect(flow).toHaveCount(0)
  const child = delivery.getByRole("treeitem", { name: /Inspect child navigation/ })
  await child.click()
  await expect(delivery.getByRole("button", { name: "Open conversation", exact: true })).toBeEnabled()
  await page.screenshot({ path: test.info().outputPath("delivery-desktop.png"), fullPage: true })
  await delivery.getByRole("button", { name: "Review changes", exact: true }).click()
  await expect(delivery).toBeHidden()
  await expect(page.locator('[data-component="session-review-v2"]')).toBeVisible()
  await toggle.click()
  await expect(delivery).toBeVisible()
  await child.click()
  await delivery.getByRole("button", { name: "Open conversation", exact: true }).click()
  await expect(page).toHaveURL(sessionHref(fixture.sessions[2].id))
  await page.getByRole("button", { name: "Open delivery overview", exact: true }).click()
  await expect(delivery.getByText("Deliver a verified task workflow", { exact: true })).toBeVisible()
  mock.state.graphUnavailable = true
  await delivery.getByRole("button", { name: "Refresh overview", exact: true }).click()
  await expect(delivery.getByRole("alert")).toContainText("The overview could not be refreshed")
  mock.state.graphUnavailable = false
  await delivery.getByRole("button", { name: "Refresh overview", exact: true }).click()
  await expect(delivery.getByRole("alert")).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("tab", { name: "Delivery", exact: true }).click()
  await expect(delivery.getByText("Deliver a verified task workflow", { exact: true })).toBeVisible()
  await delivery.getByRole("button", { name: "Flow", exact: true }).click()
  await expect(flow).toBeVisible()
  await flow.scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath("delivery-flow-mobile.png"), fullPage: true })
  await page.screenshot({ path: test.info().outputPath("delivery-mobile.png"), fullPage: true })
  await delivery.getByRole("button", { name: "Review changes", exact: true }).click()
  await expect(delivery).toBeHidden()
  expect(mock.operations).toEqual([])
})

test("delivery persists PR and external-session links across the native family without taking over the harness", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1560, height: 1000 })
  await seed(page, { theme: { id: "oc-2", scheme: "dark" } })
  await mockStressTimeline(page)
  await installStressSessionTabs(page)
  await mockAgentTasks(page)
  const state = await mockDeliveryResources(page)
  await page.goto(sessionHref(fixture.sourceID))
  await page.getByRole("button", { name: "Open delivery overview", exact: true }).click()
  const delivery = page.getByRole("region", { name: "Delivery", exact: true })
  await delivery.getByRole("tab", { name: "Resources", exact: true }).click()
  const url = delivery.getByRole("textbox", { name: "Pull request URL", exact: true })
  const link = delivery.getByRole("button", { name: "Link pull request", exact: true })
  await expect(url).toBeEnabled()
  expect(state.detailReads).toEqual([])
  await expect(delivery.getByText("No external sessions linked.", { exact: true })).toBeVisible()
  await url.fill("javascript:alert(1)")
  await expect(link).toBeDisabled()
  const href = "https://github.com/reddb-io/redcode/pull/42"
  await url.fill(href + "?tab=files#diff")
  await link.click()
  await expect(delivery.getByRole("button", { name: href, exact: true })).toBeVisible()
  await expect(link).toBeDisabled()
  state.failSave = true
  await url.fill("https://github.com/reddb-io/redcode/pull/43")
  await link.click()
  await expect(delivery.getByRole("alert")).toContainText("Resources could not be saved")
  state.failSave = false
  await link.click()
  const second = delivery
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "https://github.com/reddb-io/redcode/pull/43", exact: true }) })
  await second.getByRole("button", { name: "Unlink", exact: true }).click()
  await expect(second).toHaveCount(0)
  const external = delivery.getByRole("combobox", { name: "External session", exact: true })
  await external.selectOption("delivery-codex")
  await delivery.getByRole("button", { name: "Link external session", exact: true }).click()
  const codex = delivery.getByRole("listitem").filter({ hasText: "codex-thread-123" })
  await expect(codex.getByText("Needs input", { exact: true })).toBeVisible()
  await external.selectOption("delivery-claude")
  await delivery.getByRole("button", { name: "Link external session", exact: true }).click()
  const claude = delivery.getByRole("listitem").filter({ hasText: "claude-session-456" })
  await expect(claude.getByText("Ready", { exact: true })).toBeVisible()
  expect(state.detailReads).toEqual([])
  await codex.getByRole("button", { name: "Inspect output", exact: true }).click()
  await expect(delivery.getByRole("log", { name: "External session output", exact: true })).toHaveText(
    "Native review is waiting for your answer.",
  )
  await expect(delivery.getByText("This adapter supports steering active work.", { exact: true })).toBeVisible()
  expect(state.detailReads.every((path) => path.endsWith("/delivery-codex"))).toBe(true)
  await delivery.getByRole("button", { name: "Close details", exact: true }).click()
  await claude.getByRole("button", { name: "Inspect output", exact: true }).click()
  await expect(
    delivery.getByText("This adapter queues instructions; active steering is unavailable.", { exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("delivery-resources-desktop.png"), fullPage: true })
  await delivery.getByRole("tab", { name: "Overview", exact: true }).click()
  await delivery.getByRole("treeitem", { name: /Inspect child navigation/ }).click()
  await delivery.getByRole("button", { name: "Open conversation", exact: true }).click()
  await expect(page).toHaveURL(sessionHref(fixture.childID))
  await page.getByRole("button", { name: "Open delivery overview", exact: true }).click()
  await delivery.getByRole("tab", { name: "Resources", exact: true }).click()
  await expect(delivery.getByRole("button", { name: href, exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("tab", { name: "Delivery", exact: true }).click()
  await delivery.getByRole("tab", { name: "Resources", exact: true }).click()
  await expect(delivery.getByRole("button", { name: href, exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("delivery-resources-mobile.png"), fullPage: true })
  await page.reload()
  await page.getByRole("tab", { name: "Delivery", exact: true }).click()
  await delivery.getByRole("tab", { name: "Resources", exact: true }).click()
  await expect(delivery.getByRole("button", { name: href, exact: true })).toBeVisible()
  await expect(codex.getByText("Needs input", { exact: true })).toBeVisible()
  await codex.getByRole("button", { name: "Unlink", exact: true }).click()
  await expect(codex).toHaveCount(0)
  expect(
    state.writes.every(
      (entry) => entry.sessionID === fixture.sourceID && entry.metadata.owner === "keep-this-annotation",
    ),
  ).toBe(true)
  expect(state.skills).toEqual([])
  expect(state.harnessWrites).toEqual([])
})

test("delivery previews checkout skills and loads only into the selected conversation without resuming execution", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seed(page, { theme: { id: "oc-2", scheme: "dark" } })
  await mockStressTimeline(page, { skills: deliverySkills })
  await installStressSessionTabs(page, { sessionIDs: [fixture.childID] })
  await mockAgentTasks(page)
  const state = await mockDeliveryResources(page)
  await page.goto(sessionHref(fixture.childID))
  await page.getByRole("tab", { name: "Delivery", exact: true }).click()
  const delivery = page.getByRole("region", { name: "Delivery", exact: true })
  await delivery.getByRole("tab", { name: "Skills", exact: true }).click()
  const skills = delivery.getByRole("combobox", { name: "Available skill", exact: true })
  await expect(skills.getByRole("option", { name: "Review local changes", exact: true })).toHaveCount(1)
  await skills.selectOption("review-local")
  await expect(delivery.getByRole("region", { name: "Skill instructions", exact: true })).toContainText(
    "Do not merge or publish from this skill.",
  )
  expect(state.skills).toEqual([])
  state.failSkill = true
  await delivery.getByRole("button", { name: "Load into conversation", exact: true }).click()
  await expect(delivery.getByRole("alert")).toContainText("The skill could not be loaded")
  state.failSkill = false
  await delivery.getByRole("button", { name: "Load into conversation", exact: true }).click()
  await expect(delivery.getByRole("button", { name: "Loaded", exact: true })).toBeDisabled()
  await expect(delivery.getByRole("status")).toHaveText(
    "The skill was loaded into this conversation. Loading did not start a new execution.",
  )
  expect(state.skills).toEqual([{ sessionID: fixture.childID, id: "review-local", resume: false }])
  expect(state.writes).toEqual([])
  await page.screenshot({ path: test.info().outputPath("delivery-skills-mobile.png"), fullPage: true })
})

test("delivery monitors isolate conversations, refresh evidence and stop only the selected local observation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1560, height: 1000 })
  await seed(page, { theme: { id: "oc-2", scheme: "dark" } })
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [fixture.sourceID, fixture.childID] })
  await mockAgentTasks(page)
  const state = await mockDeliveryMonitors(page)
  await page.goto(sessionHref(fixture.childID))
  const toggle = page.getByRole("button", { name: "Open delivery overview", exact: true })
  await expect(toggle).toBeEnabled()
  // The timeline now loads the current session's monitors before the panel opens.
  await expect.poll(() => state.reads).toContain(fixture.childID)
  expect(new Set(state.reads)).toEqual(new Set([fixture.childID]))
  await toggle.click()
  const delivery = page.getByRole("region", { name: "Delivery", exact: true })
  await delivery.getByRole("tab", { name: "Monitors", exact: true }).click()
  const row = delivery.getByRole("listitem").filter({ hasText: "Wait for deployment readiness" })
  await expect(row).toContainText("Monitoring")
  expect(new Set(state.reads)).toEqual(new Set([fixture.childID]))
  await row.getByRole("button", { name: "Inspect monitor", exact: true }).click()
  const details = delivery.getByRole("region", { name: "Monitor details", exact: true })
  await expect(details).toContainText("Deployment still pending")
  await expect(details).toContainText("monitor-child")
  await expect(details).not.toContainText("monitor-parent")
  state.monitors[1].attempts = 3
  state.monitors[1].evidence!.output = "Waiting for readiness checks"
  await delivery.getByRole("button", { name: "Refresh monitors", exact: true }).click()
  await expect(details).toContainText("Waiting for readiness checks")
  state.unavailable = true
  await delivery.getByRole("button", { name: "Refresh monitors", exact: true }).click()
  await expect(delivery.getByRole("alert")).toContainText("Monitors could not be refreshed")
  await expect(details.getByRole("button", { name: "Stop monitoring", exact: true })).toBeDisabled()
  state.unavailable = false
  await delivery.getByRole("button", { name: "Refresh monitors", exact: true }).click()
  await expect(delivery.getByRole("alert")).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("tab", { name: "Delivery", exact: true }).click()
  await delivery.getByRole("tab", { name: "Monitors", exact: true }).click()
  await row.getByRole("button", { name: "Inspect monitor", exact: true }).click()
  await expect(details).toContainText("monitor-child")
  await expect(details).toContainText("External jobs keep running")
  state.cancelFailed = true
  await details.getByRole("button", { name: "Stop monitoring", exact: true }).click()
  await expect(delivery.getByRole("alert")).toContainText("Monitoring could not be stopped")
  state.cancelFailed = false
  await details.getByRole("button", { name: "Stop monitoring", exact: true }).click()
  await expect(row).toContainText("Cancelled")
  await expect(details.getByRole("button", { name: "Stop monitoring", exact: true })).toHaveCount(0)
  expect(state.cancellations).toEqual([
    { sessionID: fixture.childID, monitorID: "monitor-child" },
    { sessionID: fixture.childID, monitorID: "monitor-child" },
  ])
  expect(state.monitors[0].status).toBe("running")
  await details.scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath("delivery-monitors-mobile.png"), fullPage: true })
  await page.setViewportSize({ width: 1560, height: 1000 })
  await delivery.getByRole("tab", { name: "Monitors", exact: true }).click()
  await row.getByRole("button", { name: "Inspect monitor", exact: true }).click()
  await expect(details).toContainText("monitor-child")
  await page.screenshot({ path: test.info().outputPath("delivery-monitors-desktop.png"), fullPage: true })
  await page.clock.install()
  await delivery.getByRole("tab", { name: "Overview", exact: true }).click()
  await expect(details).toHaveCount(0)
  await expect(delivery.getByText("Deliver a verified task workflow", { exact: true })).toBeVisible()
  const reads = [...state.reads]
  const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/todo/graph"))
  await page.clock.fastForward(15000)
  await refreshed
  expect(state.reads).toEqual(reads)
})

test("delivery hooks review project definitions and confirm trust, revocation and Claude import", async ({ page }) => {
  await page.setViewportSize({ width: 1560, height: 1000 })
  await seed(page, { theme: { id: "oc-2", scheme: "dark" } })
  const directory = fixture.directory + "/linked-worktree"
  await mockStressTimeline(page, {
    sessions: fixture.sessions.map((item) => (item.id === fixture.childID ? { ...item, directory } : { ...item })),
  })
  await installStressSessionTabs(page, { sessionIDs: [fixture.sourceID, fixture.childID] })
  await mockAgentTasks(page)
  const state = await mockDeliveryHooks(page)
  await page.goto(sessionHref(fixture.childID))
  const toggle = page.getByRole("button", { name: "Open delivery overview", exact: true })
  await expect(toggle).toBeEnabled()
  expect(state.reads).toEqual([])
  await toggle.click()
  const delivery = page.getByRole("region", { name: "Delivery", exact: true })
  await delivery.getByRole("tab", { name: "Hooks", exact: true }).click()
  const definitions = delivery.getByRole("list", { name: "Hook definitions", exact: true })
  await expect(definitions).toContainText("bun run verify-project")
  await expect(definitions).toContainText("https://hooks.example.test/events")
  await expect(definitions).toContainText("Authorization")
  await expect(definitions).toContainText("Unsupported")
  await expect(page.locator("body")).not.toContainText("fixture-hidden-header")
  expect(new Set(state.reads)).toEqual(new Set([directory]))
  await delivery.getByRole("button", { name: "Approve project hooks", exact: true }).click()
  const confirmation = page.getByRole("dialog", { name: "Approve project hooks?", exact: true })
  await expect(confirmation).toContainText(directory)
  expect(state.writes).toEqual([])
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
  expect(state.writes).toEqual([])
  await delivery.getByRole("button", { name: "Approve project hooks", exact: true }).click()
  state.failChange = true
  await confirmation.getByRole("button", { name: "Confirm", exact: true }).click()
  await expect(confirmation.getByRole("alert")).toContainText("The hook action failed")
  state.failChange = false
  await confirmation.getByRole("button", { name: "Confirm", exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(delivery.getByText("Project hooks approved", { exact: true })).toBeVisible()
  await expect(definitions.getByText("Active", { exact: true })).toHaveCount(2)
  await expect(definitions.getByText("Unsupported", { exact: true })).toHaveCount(1)
  state.unavailable = true
  await delivery.getByRole("button", { name: "Refresh hooks", exact: true }).click()
  await expect(delivery.getByRole("alert")).toContainText("Hooks could not be refreshed")
  await expect(delivery.getByRole("button", { name: "Revoke approval", exact: true })).toBeDisabled()
  await expect(definitions).toContainText("bun run verify-project")
  state.unavailable = false
  await delivery.getByRole("button", { name: "Refresh hooks", exact: true }).click()
  await delivery.getByRole("button", { name: "Revoke approval", exact: true }).click()
  await page
    .getByRole("dialog", { name: "Revoke project hook approval?", exact: true })
    .getByRole("button", { name: "Confirm", exact: true })
    .click()
  await expect(delivery.getByRole("button", { name: "Approve project hooks", exact: true })).toBeEnabled()
  await page.screenshot({ path: test.info().outputPath("delivery-hooks-desktop.png"), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("tab", { name: "Delivery", exact: true }).click()
  await delivery.getByRole("tab", { name: "Hooks", exact: true }).click()
  await delivery.getByRole("button", { name: "Import Claude hooks", exact: true }).click()
  const importing = page.getByRole("dialog", { name: "Import Claude hooks?", exact: true })
  await expect(importing).toContainText("replaces the target configuration's hooks")
  await importing.getByRole("button", { name: "Confirm", exact: true }).click()
  await expect(importing).toHaveCount(0)
  await expect(delivery.getByRole("status")).toContainText("Reopen this project")
  await expect(delivery.getByRole("status")).toBeInViewport()
  expect(state.writes).toEqual([
    { action: "trust", directory },
    { action: "trust", directory },
    { action: "revoke", directory },
    { action: "import", directory },
  ])
  await page.screenshot({ path: test.info().outputPath("delivery-hooks-mobile.png"), fullPage: true })
})

test("delivery inspects only selected linked native tasks and preserves stale records without taking over execution", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1560, height: 1000 })
  await seed(page, { theme: { id: "oc-2", scheme: "dark" } })
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [fixture.sourceID, fixture.childID] })
  await mockAgentTasks(page)
  await mockDeliveryMonitors(page)
  const state = await mockDeliveryNativeTasks(page)
  await page.goto(sessionHref(fixture.childID))
  const toggle = page.getByRole("button", { name: "Open delivery overview", exact: true })
  await expect(toggle).toBeEnabled()
  await toggle.click()
  const delivery = page.getByRole("region", { name: "Delivery", exact: true })
  await delivery.getByRole("tab", { name: "Monitors", exact: true }).click()
  const native = delivery.getByRole("region", { name: "Linked harness tasks", exact: true })
  const picker = native.getByRole("combobox", { name: "Linked harness", exact: true })
  await expect(picker).toBeEnabled()
  expect(state.detailReads).toEqual([])
  await picker.selectOption("delivery-claude")
  await expect(native).toContainText("Observe native deployment")
  await native.getByRole("button", { name: "Inspect native task", exact: true }).click()
  const details = native.getByRole("region", { name: "Native task details", exact: true })
  await expect(details).toContainText("parent-native-agent")
  await expect(details).toContainText("tool-monitor")
  await expect(details).toContainText("Native deployment pending")
  await expect(details).toContainText("Waiting for a native report")
  expect(state.detailReads.every((path) => path.endsWith("delivery-claude"))).toBe(true)
  state.nativeTasks["delivery-claude"][0] = {
    ...state.nativeTasks["delivery-claude"][0],
    status: "unknown",
    wait: { ...state.nativeTasks["delivery-claude"][0].wait!, state: "timed_out", endedAt: 1793016035000 },
  }
  state.nativeUnavailable = true
  await delivery.getByRole("button", { name: "Refresh monitors", exact: true }).click()
  await expect(native.getByRole("alert")).toContainText("Native task records could not be refreshed")
  await expect(details).toContainText("Native deployment pending")
  state.nativeUnavailable = false
  await delivery.getByRole("button", { name: "Refresh monitors", exact: true }).click()
  await expect(details).toContainText("State unconfirmed")
  await expect(details).toContainText("Wait limit reached; task may still be running")
  await expect(details).toContainText("does not prove its native tasks stopped")
  await page.screenshot({ path: test.info().outputPath("native-harness-tasks-desktop.png"), fullPage: true })
  await picker.selectOption("delivery-codex")
  await expect(native).toContainText("Native build verification")
  await expect(details).toHaveCount(0)
  await native.getByRole("button", { name: "Inspect native task", exact: true }).click()
  await expect(details).toContainText("Native build passed")
  await expect(details).toContainText("pty-42")
  await expect(details).not.toContainText("parent-native-agent")
  await expect(details).not.toContainText("Latest explicit wait")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("tab", { name: "Delivery", exact: true }).click()
  await delivery.getByRole("tab", { name: "Monitors", exact: true }).click()
  await picker.selectOption("delivery-codex")
  await native.getByRole("button", { name: "Inspect native task", exact: true }).click()
  await expect(details).toContainText("Native build passed")
  await details.scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath("native-harness-tasks-mobile.png"), fullPage: true })
  delete state.nativeTasks["delivery-codex"]
  await delivery.getByRole("button", { name: "Refresh monitors", exact: true }).click()
  await expect(native).toContainText("This server does not expose native task records yet")
  expect(state.harnessWrites).toEqual([])
  state.metadata = { owner: "keep-this-annotation" }
  await delivery.getByRole("button", { name: "Refresh monitors", exact: true }).click()
  await expect(native).toContainText("Link a Claude or Codex run in Resources")
  await expect(picker).toHaveCount(0)
  await expect(native).not.toContainText("Native build verification")
  await page.clock.install()
  await delivery.getByRole("tab", { name: "Overview", exact: true }).click()
  await expect(delivery.getByText("Deliver a verified task workflow", { exact: true })).toBeVisible()
  const reads = [...state.detailReads]
  const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/todo/graph"))
  await page.clock.fastForward(15000)
  await refreshed
  expect(state.detailReads).toEqual(reads)
})

test("delivery automations persist conversation schedules, review admissions and preserve retry identities", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1560, height: 1000 })
  await seed(page, { theme: { id: "oc-2", scheme: "dark" } })
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [fixture.sourceID, fixture.childID] })
  await mockAgentTasks(page)
  const state = await mockDeliveryAutomations(page)
  await page.goto(sessionHref(fixture.childID))
  const toggle = page.getByRole("button", { name: "Open delivery overview", exact: true })
  await expect(toggle).toBeEnabled()
  expect(state.reads).toEqual([])
  await toggle.click()
  const delivery = page.getByRole("region", { name: "Delivery", exact: true })
  await delivery.getByRole("tab", { name: "Automations", exact: true }).click()
  await expect(delivery).toContainText("No automations in this conversation")
  await expect(delivery).not.toContainText("Parent schedule")
  expect(new Set(state.reads)).toEqual(new Set([fixture.childID]))
  await delivery.getByRole("button", { name: "Create automation", exact: true }).click()
  const creating = page.getByRole("dialog", { name: "Create automation", exact: true })
  await expect(creating).toContainText("start execution when due")
  expect(state.creates).toEqual([])
  await creating.getByRole("textbox", { name: "Automation name", exact: true }).fill("Check deployment")
  await creating
    .getByRole("textbox", { name: "Scheduled prompt", exact: true })
    .fill("Inspect deployment health and record evidence.")
  await creating.getByRole("spinbutton", { name: "Interval in minutes", exact: true }).fill("2")
  await creating.getByRole("button", { name: "Create automation", exact: true }).click()
  await expect(creating).toHaveCount(0)
  const row = delivery.getByRole("listitem").filter({ hasText: "Check deployment" })
  await expect(row).toContainText("Every 2 minutes")
  expect(state.creates).toHaveLength(1)
  expect(state.creates[0]).toMatchObject({
    sessionID: fixture.childID,
    input: { title: "Check deployment", schedule: { type: "interval", everyMs: 120000 } },
  })
  await row.getByRole("button", { name: "Inspect automation", exact: true }).click()
  const details = delivery.getByRole("region", { name: "Automation details", exact: true })
  await expect(details).toContainText("Inspect deployment health and record evidence.")
  await expect(details).toContainText("This automation has not fired yet")
  await details.getByRole("button", { name: "Pause schedule", exact: true }).click()
  await expect(details.getByRole("button", { name: "Resume schedule", exact: true })).toBeEnabled()
  await details.getByRole("button", { name: "Resume schedule", exact: true }).click()
  await expect(details.getByRole("button", { name: "Pause schedule", exact: true })).toBeEnabled()
  expect(state.controls.map((item) => item.enabled)).toEqual([false, true])
  await details.getByRole("button", { name: "Run now", exact: true }).click()
  const running = page.getByRole("dialog", { name: "Run this automation now?", exact: true })
  await expect(running).toContainText("Inspect deployment health and record evidence.")
  expect(state.triggers).toEqual([])
  state.failRun = true
  await running.getByRole("button", { name: "Confirm", exact: true }).click()
  await expect(running.getByRole("alert")).toContainText("The automation action failed")
  state.failRun = false
  await running.getByRole("button", { name: "Confirm", exact: true }).click()
  await expect(running).toHaveCount(0)
  await expect(details).toContainText("Prompt admitted")
  expect(state.triggers).toHaveLength(2)
  expect(state.triggers[0]).toEqual(state.triggers[1])
  expect(state.runs).toHaveLength(1)
  await details.getByRole("button", { name: "Run now", exact: true }).click()
  await running.getByRole("button", { name: "Confirm", exact: true }).click()
  await expect(running).toHaveCount(0)
  await expect(details.locator("[data-activity-event]")).toHaveCount(2)
  await expect(details.locator(`[data-activity-event="${state.runs[0].id}"]`)).toBeVisible()
  state.unavailable = true
  await delivery.getByRole("button", { name: "Refresh automations", exact: true }).click()
  await expect(delivery.getByRole("alert")).toContainText("Automations could not be refreshed")
  await expect(details.getByRole("button", { name: "Run now", exact: true })).toBeDisabled()
  await expect(details.locator("[data-activity-event]")).toHaveCount(0)
  await expect(details).toContainText("Prompt admitted")
  state.unavailable = false
  await delivery.getByRole("button", { name: "Refresh automations", exact: true }).click()
  await expect(details.getByRole("button", { name: "Run now", exact: true })).toBeEnabled()
  await page.screenshot({ path: test.info().outputPath("delivery-automations-desktop.png"), fullPage: true })
  await page.reload()
  await delivery.getByRole("tab", { name: "Automations", exact: true }).click()
  await expect(row).toContainText("Check deployment")
  expect(state.creates).toHaveLength(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("tab", { name: "Delivery", exact: true }).click()
  await delivery.getByRole("tab", { name: "Automations", exact: true }).click()
  await row.getByRole("button", { name: "Inspect automation", exact: true }).click()
  await expect(details).toContainText("Prompt admitted")
  await details.getByRole("button", { name: "Delete automation", exact: true }).click()
  const deleting = page.getByRole("dialog", { name: "Delete this automation?", exact: true })
  await deleting.getByRole("button", { name: "Cancel", exact: true }).click()
  expect(state.removals).toEqual([])
  await details.getByRole("button", { name: "Delete automation", exact: true }).click()
  await deleting.getByRole("button", { name: "Confirm", exact: true }).click()
  await expect(delivery).toContainText("No automations in this conversation")
  expect(state.items.map((item) => item.title)).toEqual(["Parent schedule"])
  await delivery.getByRole("button", { name: "Create automation", exact: true }).click()
  await creating.getByRole("textbox", { name: "Automation name", exact: true }).fill("One-time follow-up")
  await creating.getByRole("textbox", { name: "Scheduled prompt", exact: true }).fill("Check once and report findings.")
  await creating.getByRole("combobox", { name: "Schedule", exact: true }).selectOption("once")
  await creating.getByLabel("Execution time", { exact: true }).fill("2030-01-01T09:00")
  await creating.getByRole("button", { name: "Create automation", exact: true }).click()
  await expect(creating).toHaveCount(0)
  const once = delivery.getByRole("listitem").filter({ hasText: "One-time follow-up" })
  await expect(once).toContainText("One-time execution")
  expect(state.creates[1].input.schedule.type).toBe("once")
  await page.screenshot({ path: test.info().outputPath("delivery-automations-mobile.png"), fullPage: true })
  await delivery.getByRole("button", { name: "Create automation", exact: true }).click()
  await creating.getByRole("textbox", { name: "Automation name", exact: true }).fill("Morning calendar check")
  await creating
    .getByRole("textbox", { name: "Scheduled prompt", exact: true })
    .fill("Inspect build health on selected mornings.")
  await creating.getByRole("combobox", { name: "Schedule", exact: true }).selectOption("fixed_time")
  await creating.getByLabel("Time of day", { exact: true }).fill("09:00")
  const zone = creating.getByRole("textbox", { name: "Schedule time zone", exact: true })
  await zone.fill("Not/AZone")
  await creating.getByRole("button", { name: "Create automation", exact: true }).click()
  await expect(creating.getByRole("alert")).toContainText("valid time and named time zone")
  expect(state.creates).toHaveLength(2)
  await zone.fill("America/Sao_Paulo")
  await creating.getByRole("checkbox", { name: "Saturday", exact: true }).uncheck()
  await creating.getByRole("checkbox", { name: "Sunday", exact: true }).uncheck()
  await expect(creating).toContainText("up to 10 minutes of delay")
  await expect(creating.getByRole("button", { name: "Create automation", exact: true })).toBeInViewport()
  await expect(creating.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport()
  await page.screenshot({ path: test.info().outputPath("delivery-calendar-form-mobile.png"), fullPage: true })
  await creating.getByRole("button", { name: "Create automation", exact: true }).click()
  await expect(creating).toHaveCount(0)
  const calendar = delivery.getByRole("listitem").filter({ hasText: "Morning calendar check" })
  await expect(calendar).toContainText("Monday, Tuesday, Wednesday, Thursday, Friday at 09:00 · America/Sao_Paulo")
  expect(state.creates[2].input.schedule).toEqual({
    type: "fixed_time",
    timeOfDay: "09:00",
    timeZone: "America/Sao_Paulo",
    weekdays: [1, 2, 3, 4, 5],
  })
  await calendar.getByRole("button", { name: "Inspect automation", exact: true }).click()
  await expect(details).toContainText("Schedule time zone")
  await expect(details).toContainText("1/7/30, 9:00 AM")
  await expect(details).toContainText("America/Sao_Paulo")
  await page.setViewportSize({ width: 1560, height: 1000 })
  await delivery.getByRole("tab", { name: "Automations", exact: true }).click()
  await calendar.getByRole("button", { name: "Inspect automation", exact: true }).click()
  await expect(details).toContainText("Morning calendar check")
  await page.screenshot({ path: test.info().outputPath("delivery-calendar-desktop.png"), fullPage: true })
  await page.reload()
  await delivery.getByRole("tab", { name: "Automations", exact: true }).click()
  await expect(calendar).toContainText("America/Sao_Paulo")
  expect(state.creates).toHaveLength(3)
  await page.clock.install()
  await delivery.getByRole("tab", { name: "Overview", exact: true }).click()
  await expect(delivery.getByText("Deliver a verified task workflow", { exact: true })).toBeVisible()
  const reads = [...state.reads]
  const historyReads = [...state.historyReads]
  const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/todo/graph"))
  await page.clock.fastForward(15000)
  await refreshed
  expect(state.reads).toEqual(reads)
  expect(state.historyReads).toEqual(historyReads)
})

test("conditional automations require a supporting server and retain the selected probe", async ({ page }) => {
  await page.setViewportSize({ width: 1560, height: 1000 })
  await seed(page, { theme: { id: "oc-2", scheme: "dark" } })
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [fixture.sourceID, fixture.childID] })
  await mockAgentTasks(page)
  const state = await mockDeliveryAutomations(page)
  state.conditionalSupported = false
  await page.goto(sessionHref(fixture.childID))
  await page.getByRole("button", { name: "Open delivery overview", exact: true }).click()
  const delivery = page.getByRole("region", { name: "Delivery", exact: true })
  await delivery.getByRole("tab", { name: "Automations", exact: true }).click()
  await delivery.getByRole("button", { name: "Create automation", exact: true }).click()
  const form = page.getByRole("dialog", { name: "Create automation", exact: true })
  await form.getByRole("textbox", { name: "Automation name" }).fill("Watch health")
  await form.getByRole("textbox", { name: "Scheduled prompt" }).fill("Inspect the service")
  await form.getByRole("combobox", { name: "Run only when" }).selectOption("http")
  await form.getByRole("combobox", { name: "When to run" }).selectOption("on_change")
  await expect(form).toContainText("first check establishes a baseline")
  await form.getByRole("textbox", { name: "HTTP or HTTPS URL" }).fill("https://example.com/health")
  await form.getByRole("button", { name: "Create automation", exact: true }).click()
  await expect(form.getByRole("alert")).toContainText("automation action failed")
  expect(state.conditionalAttempts).toBe(1)
  expect(state.creates).toHaveLength(0)
  state.conditionalSupported = true
  await form.getByRole("button", { name: "Create automation", exact: true }).click()
  await expect(form).toHaveCount(0)
  expect(state.conditionalAttempts).toBe(2)
  expect(state.creates[0].input.condition).toEqual({
    when: "matches",
    mode: "on_change",
    probe: { type: "http", url: "https://example.com/health" },
  })
  const row = delivery.getByRole("listitem").filter({ hasText: "Watch health" })
  await row.getByRole("button", { name: "Inspect automation" }).click()
  await expect(delivery.getByRole("region", { name: "Automation details" })).toContainText("https://example.com/health")
})

test("review and terminal follow the session tab and stay mounted", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 })
  const a = { id: "ses_side_a", title: "Alpha session" }
  const b = { id: "ses_side_b", title: "Beta session" }

  const { directory, pty } = await openSession(page, {
    name: "SidePanels",
    sessions: [a, b],
    pty: {},
    vcsDiff: Array.from({ length: 2_740 }, (_, index) =>
      fileDiff(`src/generated-${String(index).padStart(4, "0")}.ts`),
    ),
    seed: {
      panes: { [a.id]: { sessionWidth: 580, terminalHeight: 300 }, [b.id]: { sessionWidth: 520, terminalHeight: 180 } },
      settings: { general: { terminalPlacement: "bottom" } },
    },
  })

  const chat = page.locator('[data-slot="session-chat-panel"]')
  const review = page.locator('#review-panel [data-component="session-review-v2"]')
  const terminal = page.locator('[data-component="terminal"]')
  const terminalPanel = page.locator('[data-component="terminal-panel"]')

  const switchTab = async (title: string) => {
    await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
    await expectSessionTitle(page, title)
  }

  const transition = () => chat.evaluate((element) => getComputedStyle(element).transitionDuration)
  await page.getByRole("button", { name: "Toggle review" }).click()
  await expect.poll(transition).not.toBe("0s")
  await page.keyboard.press("Control+Backquote")
  await expect(review).toBeVisible()
  await expect(terminal).toBeVisible()
  await expect(terminalPanel).toHaveAttribute("data-size-animated", "true")
  await expect(chat).toHaveCSS("width", "580px")
  await expect(terminalPanel).toHaveCSS("height", "300px")
  await expect(page.locator("#session-side-panel-review-tab")).toHaveText("Files Changed 2740")
  await expect.poll(() => pty.sockets.length).toBe(1)
  const filter = page.getByRole("searchbox", { name: "Filter files" })
  await filter.fill("generated-0027")
  await expect(
    page.locator('#review-panel [data-component="file-tree-v2"]').getByRole("button", { name: "generated-0027.ts" }),
  ).toBeVisible()
  await mark(review)
  await mark(terminal)

  await switchTab(b.title)
  await expect(review).toBeHidden()
  await expect(terminal).toBeHidden()
  await expect(terminalPanel).toHaveAttribute("data-size-animated", "false")
  await expect.poll(transition).toBe("0s")
  await expectMarked(review)
  await expectMarked(terminal)
  await page.getByRole("button", { name: "Toggle review" }).click()
  await page.keyboard.press("Control+Backquote")
  await expect(review).toBeVisible()
  await expect(terminal).toBeVisible()
  await expect(chat).toHaveCSS("width", "520px")
  await expect(terminalPanel).toHaveCSS("height", "180px")

  await switchTab(a.title)
  await expect(review).toBeVisible()
  await expect(terminal).toBeVisible()
  await expect(chat).toHaveCSS("width", "580px")
  await expect(terminalPanel).toHaveCSS("height", "300px")
  await expectMarked(review)
  await expectMarked(terminal)
  await expect(filter).toHaveValue("generated-0027")
  expect(pty.sockets).toHaveLength(1)
  expect(pty.sockets[0]!.url.searchParams.get("location[directory]")).toBe(directory)
  expect(pty.sockets[0]!.url.searchParams.get("ticket")).toBe("e2e-ticket")
  expect(pty.tokens[0]?.headers["x-opencode-ticket"]).toBe("1")

  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem("opencode.window.browser.dat:tabs.panes") ?? "{}")[key]?.review,
        tabKey(a.id),
      ),
    )
    .toBe(true)
  await page.reload()
  await expectSessionTitle(page, a.title)
  await expect(review).toBeVisible()
  await expect(terminal).toBeVisible()
  await expect(chat).toHaveCSS("width", "580px")
  await expect(terminalPanel).toHaveCSS("height", "300px")

  const tree = page.locator('#review-panel [data-component="file-tree-v2"]')
  await expect(tree.getByRole("button", { name: "generated-0000.ts" })).toBeVisible()
  expect(await tree.locator('[data-slot="file-tree-v2-row"]').count()).toBeLessThanOrEqual(60)
  const viewport = page.locator('#review-panel [data-slot="session-review-v2-sidebar-tree"] .scroll-view__viewport')
  await viewport.hover()
  await page.mouse.wheel(0, 100_000)
  await expect(tree.getByRole("button", { name: "generated-2739.ts" })).toBeVisible()
})

test("keeps review hidden while the side terminal remains usable", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await openSession(page, { name: "ReviewDock", pty: {}, vcsDiff: [fileDiff("src/example.ts")] })
  const toggle = page.getByRole("button", { name: "Toggle review" })
  const review = page.locator('#review-panel [data-component="session-review-v2"]')
  const terminal = page.locator('[data-component="terminal"]')
  await toggle.click()
  await expect(review).toBeVisible()
  await mark(review)
  await page.keyboard.press("Control+Backquote")
  await expect(terminal).toBeVisible()
  await toggle.click()
  await expect(review).toBeHidden()
  await expect(terminal).toBeVisible()
  await expectMarked(review)
  await toggle.click()
  await expect(review).toBeVisible()
  await expect(terminal).toBeVisible()
  await expectMarked(review)
})

test("the workbench stacks and resizes review and terminal groups", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })

  // A large nested branch diff; its first file is the sentinel that proves the virtualized tree stays mounted.
  const diffs = [
    fileDiff(".github/actions/setup-bun/action.yml", { additions: 7 }),
    ...Array.from({ length: 2_739 }, (_, index) =>
      fileDiff(
        `src/branch/d${String(Math.floor(index / 100)).padStart(5, "0")}/generated-${String(index).padStart(4, "0")}.ts`,
        { additions: 100, loaded: false },
      ),
    ),
  ]

  await openSession(page, { name: "SideStack", pty: {}, vcsDiff: diffs })
  const toggle = page.getByRole("button", { name: "Toggle review" })
  const workbench = page.locator('[data-component="workbench"]')
  const reviewGroup = workbench.getByRole("region", { name: "Top panel group" })
  const terminalGroup = workbench.getByRole("region", { name: "Bottom panel group" })
  const divider = workbench.getByRole("separator", { name: "Resize panel groups" })
  const terminalPanel = page.locator("#terminal-panel")
  const review = page.locator('[data-component="session-review-v2"]')
  const terminal = page.locator('[data-component="terminal"]')

  await toggle.click()
  await expect(reviewGroup).toBeVisible()
  await expectTreeSentinel(page)

  for (const direction of ["ltr", "rtl"] as const) {
    await page.evaluate((direction) => (document.documentElement.dir = direction), direction)
    await expect.poll(() => sideContentOffset(page, direction)).toBeLessThanOrEqual(1)
  }

  await page.evaluate(() => (document.documentElement.dir = "ltr"))

  await page.keyboard.press("Control+Backquote")
  await expect(terminalPanel).toBeVisible()
  await expect(terminal).toBeVisible()
  await expect(workbench).toHaveAttribute("data-split", "true")
  await expect(divider).toBeVisible()
  await expect
    .poll(async () => {
      const top = await reviewGroup.boundingBox()
      const bottom = await terminalGroup.boundingBox()
      const split = await divider.boundingBox()
      if (!top || !bottom || !split) return false

      return (
        Math.abs(top.x - bottom.x) <= 1 &&
        Math.abs(top.x + top.width - bottom.x - bottom.width) <= 1 &&
        top.y + top.height <= split.y + 1 &&
        split.y + split.height <= bottom.y + 1
      )
    })
    .toBe(true)
  await expectTreeSentinel(page)
  await mark(review)
  await mark(terminal)

  // The workbench divider changes the relative group sizes without remounting either panel.
  const ratio = Number(await divider.getAttribute("aria-valuenow"))
  const topHeight = (await reviewGroup.boundingBox())!.height
  const bottomHeight = (await terminalGroup.boundingBox())!.height
  await divider.focus()
  await page.keyboard.press("ArrowDown")
  await expect(divider).toHaveAttribute("aria-valuenow", String(ratio + 5))
  await expect.poll(async () => (await reviewGroup.boundingBox())!.height).toBeGreaterThan(topHeight)
  await expect.poll(async () => (await terminalGroup.boundingBox())!.height).toBeLessThan(bottomHeight)
  await expectMarked(review)
  await expectMarked(terminal)

  // With review closed, the terminal fills the workbench; reopening restores both surfaces.
  await toggle.click()
  await expect(review).toBeHidden()
  await expect(terminalPanel).toBeVisible()
  await expect(workbench).toHaveAttribute("data-split", "false")
  await expect(divider).toHaveCount(0)
  await expect
    .poll(async () => {
      const group = await terminalGroup.boundingBox()
      const column = await workbench.boundingBox()
      return !!group && !!column && Math.abs(group.height - column.height) <= 1
    })
    .toBe(true)

  await toggle.click()
  await expect(review).toBeVisible()
  await expect(workbench).toHaveAttribute("data-split", "true")
  await expectMarked(review)
  await expectTreeSentinel(page)

  // Closing the terminal leaves review filling the workbench, with the terminal parked for reuse.
  await page.keyboard.press("Control+Backquote")
  await expect(terminalPanel).toBeHidden()
  await expect(review).toBeVisible()
  await expect(workbench).toHaveAttribute("data-split", "false")
  await expect(divider).toHaveCount(0)
  await expect
    .poll(async () => {
      const group = await reviewGroup.boundingBox()
      const column = await workbench.boundingBox()
      return !!group && !!column && Math.abs(group.height - column.height) <= 1
    })
    .toBe(true)
  await expectMarked(terminal)
  await page.setViewportSize({ width: 1200, height: 700 })
  await page.keyboard.press("Control+Backquote")
  await expect(terminal).toBeVisible()
  await expectMarked(terminal)
  await expectTreeSentinel(page)
  expect(await page.evaluate(() => window.scrollX)).toBe(0)
  await page.keyboard.press("Control+Backquote")
  await expect(terminalPanel).toBeHidden()
})

test("a bottom-placed terminal spans the session below the review panel", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 })
  await openSession(page, {
    name: "BottomTerminal",
    pty: {},
    vcsDiff: [fileDiff(".github/actions/setup-bun/action.yml")],
    seed: { settings: { general: { terminalPlacement: "bottom" } } },
  })
  const reviewPanel = page.locator("#review-panel")
  const terminalPanel = page.locator("#terminal-panel")
  const terminal = page.locator('[data-component="terminal"]')
  await page.getByRole("button", { name: "Toggle review" }).click()
  await expect(reviewPanel).toBeVisible()
  await expectTreeSentinel(page)
  await page.keyboard.press("Control+Backquote")
  await expect(terminalPanel).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const review = document.querySelector("#review-panel")?.getBoundingClientRect()
        const terminal = document.querySelector("#terminal-panel")?.getBoundingClientRect()
        const chat = document.querySelector('[data-slot="session-chat-panel"]')?.getBoundingClientRect()
        const sidebar = document.querySelector('#review-panel [data-slot="session-review-v2-sidebar"]')

        // The side region appears before its lazy review content after reload.
        if (!review || !terminal || !chat || !sidebar) return false
        const gap = terminal.top - review.bottom

        return (
          Math.abs(terminal.left - chat.left) <= 1 &&
          Math.abs(terminal.right - review.right) <= 1 &&
          gap >= 7 &&
          gap <= 9 &&
          sidebar.getBoundingClientRect().width >= 240
        )
      }),
    )
    .toBe(true)
  await expectTreeSentinel(page)
  await page.keyboard.press("Control+Backquote")
  await expect(terminalPanel).toBeHidden()
  await expect(terminal).toBeAttached()
})

for (const direction of ["ltr", "rtl"] as const) {
  test(`terminal controls stay clear of the review toggle in ${direction}`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 })
    const { pty } = await openSession(page, { name: "TerminalControls", pty: { prefix: "pty_review_" } })
    await page.locator("html").evaluate((element, dir) => element.setAttribute("dir", dir), direction)

    const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
    await expect(toggle).toHaveAttribute("aria-pressed", "false")
    await page.keyboard.press("Control+Backquote")
    const terminal = page.locator('[data-slot="terminal-tabs-toolbar"]')
    await expect(terminal.getByRole("tab", { name: "Terminal 1", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    )

    for (const number of [2, 3, 4]) {
      await terminal.getByRole("button", { name: "New terminal", exact: true }).click()
      await expect(terminal.getByRole("tab", { name: `Terminal ${number}`, exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      )
    }

    await expectPanelControlsSeparated(terminal, toggle)
    await terminal
      .locator('[data-slot="tabs-trigger-wrapper"][data-value="pty_review_4"]')
      .getByRole("button", { name: "Close terminal", exact: true })
      .click()
    await expect(terminal.getByRole("tab")).toHaveText(["Terminal 1", "Terminal 2", "Terminal 3"])
    expect(pty.removed).toEqual(["pty_review_4"])
    await expect(toggle).toHaveAttribute("aria-pressed", "false")

    // The client names a new terminal with the lowest free number.
    await terminal.getByRole("button", { name: "New terminal", exact: true }).click()
    await expect(terminal.getByRole("tab", { name: "Terminal 4", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    await expect(terminal.locator('[data-slot="tabs-trigger-wrapper"][data-value="pty_review_5"]')).toHaveCount(1)
    await expect(toggle).toHaveAttribute("aria-pressed", "false")
    const position = await toggle.boundingBox()
    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-pressed", "true")
    await expect(page.locator("#review-panel")).toHaveAttribute("aria-hidden", "false")
    await expect.poll(() => toggle.boundingBox()).toEqual(position)
    await expect
      .poll(async () => {
        const actions = (await page.locator('[data-slot="session-panel-toggles"]').boundingBox())!
        const button = (await toggle.boundingBox())!

        return actions.y + actions.height / 2 - (button.y + button.height / 2)
      })
      .toBe(0)
    await toggle.press("Enter")
    await expect(toggle).toHaveAttribute("aria-pressed", "false")
    await expect(toggle).toBeFocused()
    await expect.poll(() => toggle.boundingBox()).toEqual(position)
    await expectPanelControlsSeparated(terminal, toggle)
  })
}

// A DOM mark survives only while the same node stays mounted.
function mark(locator: Locator) {
  return locator.evaluate((element) => element.setAttribute("data-e2e-mounted", "original"))
}

function expectMarked(locator: Locator) {
  return expect(locator).toHaveAttribute("data-e2e-mounted", "original")
}

async function expectTreeSentinel(page: Page) {
  const tree = page.locator('#review-panel [data-component="file-tree-v2"]')
  await expect(tree.getByRole("button", { name: "action.yml" })).toBeVisible()
  const rows = await tree.locator('[data-slot="file-tree-v2-row"]').count()
  expect(rows).toBeGreaterThan(0)
  expect(rows).toBeLessThanOrEqual(60)
}

function sideContentOffset(page: Page, direction: "ltr" | "rtl") {
  return page.evaluate((direction) => {
    const frame = document.querySelector('[data-slot="session-side-panel-presence"]')!.getBoundingClientRect()
    const content = document.querySelector('[data-slot="session-side-panel-content"]')!.getBoundingClientRect()

    return direction === "rtl" ? Math.abs(frame.right - content.right) : Math.abs(frame.left - content.left)
  }, direction)
}

// Panel controls and terminal controls must not overlap.
async function expectPanelControlsSeparated(terminal: Locator, toggle: Locator) {
  await expect
    .poll(async () => {
      const button = await toggle.boundingBox()
      const controls = await Promise.all(
        [terminal.getByRole("tablist"), terminal.getByRole("button", { name: "New terminal", exact: true })].map(
          (control) => control.boundingBox(),
        ),
      )
      if (!button || controls.some((control) => !control)) return false
      return controls.every(
        (control) =>
          control &&
          (control.x + control.width <= button.x ||
            button.x + button.width <= control.x ||
            control.y + control.height <= button.y ||
            button.y + button.height <= control.y),
      )
    })
    .toBe(true)
}
