import { expect, test } from "@playwright/test"
import type { Worker } from "@opencode/schema/worker"
import { WorkerLease } from "@opencode/schema/worker-lease"
import { Schema } from "effect"
import { fixture, installStressSessionTabs, mockStressTimeline } from "../utils/session-fixture"
import { sessionHref } from "../utils/app"
import { status } from "../utils/timeline"
import {
  mockRemoteWorkers,
  mockWaitingWorker,
  mockWorkerTaskInspection,
  mockWorkerDistribution,
} from "../utils/worker-fixture"
import {
  mockNativeUsage,
  mockLocalSlots,
  mockHarnessOperations,
  mockWorktreeOperations,
  mockMachineInspection,
  mockWorkerEnvironments,
  mockProjectEnvironments,
} from "../utils/agent-operation-fixture"
import { SERVER, REMOTE_SERVER } from "../utils/app"
import { chooseSearchOption } from "../utils/search-select"
import { mockAgentTasks } from "../utils/agent-task-fixture"

test.use({ viewport: { width: 1440, height: 900 } })

// LAN HTTP pages expose getRandomValues but not the secure-context randomUUID API.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined })
  })
})

test("reconciles task contributions through the DS and preserves an uncertain application identity", async ({
  page,
}) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  const mock = await mockAgentTasks(page)
  await page.goto("/agents?view=tasks")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  await expect(
    page.getByRole("navigation", { name: "Agents", exact: true }).getByRole("button", { name: "Tasks", exact: true }),
  ).toHaveAttribute("aria-current", "page")
  await expect(workspace.getByLabel("Session", { exact: true })).toBeEnabled()
  await workspace.getByLabel("Session", { exact: true }).selectOption(mock.sessionID)
  await expect(workspace.getByText("Deliver a verified task workflow", { exact: true })).toBeVisible()
  await expect(workspace.getByText("Context version aaaaaaaaaaaa", { exact: true })).toBeVisible()
  await expect(workspace.getByRole("progressbar", { name: "Task completion" })).toHaveAttribute("aria-valuenow", "2")
  await workspace.getByRole("button", { name: "Reconcile delegated results Pending", exact: true }).click()
  const detail = workspace.getByRole("region", { name: "Task details", exact: true })
  const convergence = detail.getByRole("region", { name: "Result convergence", exact: true })
  await expect(convergence.getByRole("status")).toHaveText("2 of 2 required results are accepted and settled.")
  const contribution = detail.getByRole("article", { name: "Implement task API", exact: true })
  await contribution.getByText(fixture.sessions[2].id + " · Succeeded", { exact: true }).click()
  await contribution.getByText("Received shared objective", { exact: true }).click()
  await expect(contribution.getByText("Deliver a verified task workflow", { exact: true })).toBeVisible()
  await expect(contribution.getByText("Context version aaaaaaaaaaaa", { exact: true })).toBeVisible()
  await expect(contribution.getByText("Delegated result for api", { exact: true })).toBeVisible()
  await expect(contribution.getByText("bash · check-api · Succeeded", { exact: true })).toBeVisible()
  await expect(detail.getByRole("heading", { name: "Files changed by multiple prerequisites" })).toBeVisible()
  const integration = detail.getByRole("region", { name: "Reconcile results", exact: true })
  await integration.getByLabel("Target checkout on this host", { exact: true }).selectOption(fixture.directory)
  await detail.getByRole("tab", { name: "Reconciliation stages", exact: true }).click()
  await expect(detail.getByRole("list", { name: "Reconciliation stages", exact: true })).toBeVisible()
  await detail.getByRole("tab", { name: "Task details", exact: true }).click()
  await expect(integration.getByLabel("Target checkout on this host", { exact: true })).toHaveValue(fixture.directory)
  await expect(integration.getByRole("button", { name: "Prepare combined candidate", exact: true })).toBeEnabled()
  await integration.getByRole("button", { name: "Prepare combined candidate", exact: true }).click()
  await expect(integration.getByLabel("Combined candidate diff", { exact: true })).toContainText(
    "+export const reconciled = true",
  )
  await expect(
    integration.getByText(
      "The session must verify and accept this exact candidate before application becomes available.",
      { exact: true },
    ),
  ).toBeVisible()
  await expect(integration.getByRole("button", { name: "Confirm application to target", exact: true })).toHaveCount(0)
  expect(mock.operations).toEqual([
    { action: "prepare", input: { revision: 3, target: fixture.directory, targetHead: "b".repeat(40) } },
  ])
  await page.screenshot({ path: test.info().outputPath("agent-tasks-desktop.png"), fullPage: true })
  mock.accept()
  await workspace.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(detail.getByText("The combined candidate passed the project checks", { exact: true })).toBeVisible()
  await expect(
    integration.getByText("The task changed since this preview. Review the bound candidate again.", { exact: true }),
  ).toBeVisible()
  await expect(integration.getByRole("button", { name: "Confirm application to target", exact: true })).toHaveCount(0)
  await integration.getByRole("button", { name: "Review bound candidate", exact: true }).click()
  const apply = integration.getByRole("button", { name: "Confirm application to target", exact: true })
  await expect(apply).toBeEnabled()
  await page.setViewportSize({ width: 390, height: 844 })
  await apply.scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath("agent-tasks-mobile.png"), fullPage: true })
  await apply.click()
  const retry = integration.getByRole("button", { name: "Retry original application request", exact: true })
  await expect(retry).toBeEnabled()
  await retry.click()
  await expect(
    integration.getByText("The accepted candidate was applied to its target checkout.", { exact: true }),
  ).toBeVisible()
  const applications = mock.operations.filter((item) => item.action === "apply")
  expect(applications).toHaveLength(2)
  expect(applications[0].input).toMatchObject({
    revision: 5,
    candidateHead: "c".repeat(40),
    requestID: expect.any(String),
  })
  expect(applications[1].input).toEqual(applications[0].input)
  expect(applications[0].input).not.toMatchObject({ requestID: "older-application" })
  const graph = workspace.getByRole("list", { name: "Task dependencies", exact: true })
  await expect(graph.getByText("Delegated revision 2", { exact: true })).toBeVisible()
  await graph.getByRole("button", { name: "Open delegated session: " + fixture.sessions[2].id, exact: true }).click()
  await expect(page).toHaveURL(sessionHref(fixture.sessions[2].id))
})

test("keeps task navigation usable when reconciliation fails and recovers on refresh", async ({ page }) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  const mock = await mockAgentTasks(page)
  mock.tasks[1] = {
    ...mock.tasks[1],
    status: "blocked",
    evidence: undefined,
    reason: "Verification needs a recorded check",
  }
  mock.nodes[2] = { ...mock.nodes[2], waitingFor: ["tests"], ready: false }
  mock.assignments[0] = { ...mock.assignments[0], revision: 1, current: false, state: "running", outcome: undefined }
  mock.state.executionSettled = false
  mock.state.acceptanceReady = false
  mock.state.inputAcceptance = ["stale", "blocked"]
  mock.state.reportUnavailable = true
  await page.goto("/agents?view=tasks")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  await expect(workspace.getByLabel("Session", { exact: true })).toBeEnabled()
  await workspace.getByLabel("Session", { exact: true }).selectOption(mock.sessionID)
  const graph = workspace.getByRole("list", { name: "Task dependencies", exact: true })
  await expect(graph.getByText("Delegated revision 1", { exact: true })).toBeVisible()
  await expect(graph.getByText("Stale", { exact: true })).toBeVisible()
  await expect(graph.getByText("Verification needs a recorded check", { exact: true })).toBeVisible()
  const dependency = graph.getByRole("button", { name: "Inspect prerequisite: Verify task API", exact: true })
  await expect(dependency).toContainText("Awaiting acceptance")
  await dependency.focus()
  await page.keyboard.press("Enter")
  await expect(graph.getByRole("button", { name: "Verify task API Blocked", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await workspace.getByRole("button", { name: "Reconcile delegated results Pending", exact: true }).click()
  await expect(workspace.getByRole("alert")).toHaveText("Task data could not be loaded. Refresh to try again.")
  await expect(workspace.getByLabel("Session", { exact: true })).toBeEnabled()
  await expect(workspace.getByRole("button", { name: "Implement task API Completed", exact: true })).toBeEnabled()
  await expect(workspace.getByRole("button", { name: "Prepare combined candidate", exact: true })).toHaveCount(0)
  mock.state.reportUnavailable = false
  await workspace.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(workspace.getByRole("alert")).toHaveCount(0)
  await expect(workspace.getByRole("region", { name: "Reconcile results", exact: true })).toBeVisible()
  await expect(workspace.getByRole("list", { name: "Results awaiting acceptance", exact: true })).toHaveText(
    "Implement task APIVerify task API",
  )
  await expect(graph.getByText("Assigned context bbbbbbbbbbbb", { exact: true })).toBeVisible()
  mock.state.context = {
    ...mock.state.context,
    version: "c".repeat(64),
    goal: { ...mock.state.context.goal, objective: "Deliver with the updated compatibility requirements" },
  }
  await workspace.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(workspace.getByText("Context version cccccccccccc", { exact: true })).toBeVisible()
  await expect(workspace.getByRole("status").filter({ hasText: "The shared objective changed." })).toHaveText(
    "The shared objective changed. Refresh to inspect current results.",
  )
  await expect(workspace.getByRole("region", { name: "Reconcile results", exact: true })).toHaveCount(0)
  mock.reportContext.current = mock.state.context
  await workspace.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(workspace.getByRole("region", { name: "Reconcile results", exact: true })).toBeVisible()
  mock.tasks[1] = { ...mock.tasks[1], status: "completed", reason: undefined }
  await workspace.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(dependency).toContainText("Awaiting acceptance")
  mock.tasks[1] = {
    ...mock.tasks[1],
    evidence: { ...mock.tasks[0].evidence!, callID: "check-tests", messageID: "message-tests", hash: "proof-tests" },
  }
  mock.nodes[2] = { ...mock.nodes[2], waitingFor: [], ready: true }
  await workspace.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(dependency).toContainText("Completion recorded")
  mock.state.graphUnavailable = true
  await workspace.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(workspace.getByRole("alert")).toHaveText("Task data could not be loaded. Refresh to try again.")
  await expect(graph).toHaveCount(0)
  mock.state.graphUnavailable = false
  await workspace.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(graph).toBeVisible()
  expect(mock.operations).toHaveLength(0)
})

test("saves a project environment through the DS and requires review before running on its selected worktree", async ({
  page,
}) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  const mock = await mockProjectEnvironments(page)
  await page.goto("/agents?view=project-environments")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  await expect(
    page
      .getByRole("navigation", { name: "Agents", exact: true })
      .getByRole("button", { name: "Project environments", exact: true }),
  ).toHaveAttribute("aria-current", "page")
  await workspace.getByLabel("Project or worktree directory on this host").fill(fixture.directory)
  await workspace.getByRole("button", { name: "Open environments", exact: true }).click()
  await workspace.getByLabel("Recipe name", { exact: true }).fill("Payments development")
  await workspace.getByLabel("Preparation command (optional)").fill("bun install --frozen-lockfile")
  await workspace.getByLabel("Validation command", { exact: true }).fill("bun run check")
  await workspace.getByLabel("Vault bindings (one VARIABLE=vault-name per line)").fill("API_TOKEN=payments-token")
  await workspace.getByRole("button", { name: "Save recipe", exact: true }).click()
  await expect(workspace.getByRole("status")).toContainText("Recipe saved.")
  const recipe = workspace.getByRole("article", { name: "Payments development", exact: true })
  await expect(recipe.getByText("Recipe revision 1", { exact: true })).toBeVisible()
  expect(mock.operations).toHaveLength(0)
  await recipe.getByRole("button", { name: "Start", exact: true }).click()
  await expect(
    recipe.getByText("Review this recipe before running it on the selected host.", { exact: false }),
  ).toBeVisible()
  expect(mock.operations).toHaveLength(0)
  await recipe.getByRole("button", { name: "Confirm operation", exact: true }).click()
  await expect(recipe.getByRole("status")).toHaveText("Validation passed")
  await expect(recipe.getByText("Application checks passed", { exact: true })).toBeVisible()
  expect(mock.operations).toHaveLength(1)
  expect(mock.operations[0]).toMatchObject({
    directory: fixture.directory,
    recipeID: "dev",
    revision: 1,
    action: "start",
  })
  await page.screenshot({ path: test.info().outputPath("project-environments-desktop.png"), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(recipe.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("project-environments-mobile.png"), fullPage: true })
})

test("prepares an isolated workspace through the DS and restores retained data before explicit deletion", async ({
  page,
}) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  await mockWorkerEnvironments(page)
  await mockRemoteWorkers(page)
  await page.goto("/agents?view=environments")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  await expect(
    page
      .getByRole("navigation", { name: "Agents", exact: true })
      .getByRole("button", { name: "Isolated workspaces", exact: true }),
  ).toHaveAttribute("aria-current", "page")
  await workspace.getByRole("button", { name: "Build worker image on this host", exact: true }).click()
  await expect(workspace.getByText("Worker image is ready.", { exact: true })).toBeVisible()
  await workspace.getByLabel("Environment name", { exact: true }).fill("public-worker")
  await workspace
    .getByLabel("Public HTTPS Git repository", { exact: true })
    .fill("https://github.com/octocat/Hello-World.git")
  await workspace.getByLabel("CPU limit", { exact: true }).fill("0.5")
  await workspace.getByLabel("Memory limit (MiB)", { exact: true }).fill("512")
  await workspace.getByLabel("Model provider (optional)", { exact: true }).selectOption("anthropic")
  await workspace.getByLabel("Workspace provider API key", { exact: true }).fill("fixture-workspace-key")
  const prepared = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/worker-environments" && response.request().method() === "POST",
  )
  await workspace.getByRole("button", { name: "Create isolated workspace", exact: true }).click()
  expect((await prepared).request().postDataJSON()).toEqual({
    id: "public-worker",
    repository: "https://github.com/octocat/Hello-World.git",
    ref: "HEAD",
    image: "redcode-worker:0.80.0",
    cpu: 0.5,
    memoryMiB: 512,
    provider: { integrationID: "anthropic", key: "fixture-workspace-key" },
  })
  await expect(workspace.getByLabel("Workspace provider API key", { exact: true })).toHaveValue("")
  const environment = workspace.getByRole("article", { name: "public-worker", exact: true })
  await expect(environment).toContainText("Base commit: " + "a".repeat(40))
  await expect(environment.getByRole("button", { name: "Register isolated worker", exact: true })).toBeEnabled()
  await environment.scrollIntoViewIfNeeded()
  await page.screenshot({
    path: test.info().outputPath("isolated-workspace-ds.png"),
    animations: "disabled",
    fullPage: true,
  })
  await environment.getByRole("button", { name: "Stop environment", exact: true }).click()
  await expect(environment.getByRole("button", { name: "Archive and retain workspace", exact: true })).toBeEnabled()
  await environment.getByRole("button", { name: "Archive and retain workspace", exact: true }).click()
  await expect(environment).toContainText("Archived")
  await environment.getByRole("button", { name: "Start or restore", exact: true }).click()
  await expect(environment).toContainText("Ready")
  await environment.getByRole("button", { name: "Stop environment", exact: true }).click()
  await expect(environment.getByRole("button", { name: "Delete permanently", exact: true })).toBeEnabled()
  await environment.getByRole("button", { name: "Delete permanently", exact: true }).click()
  await expect(environment).toContainText("Permanently delete this environment")
  await environment.getByRole("button", { name: "Confirm permanent deletion", exact: true }).click()
  await expect(environment).toHaveCount(0)
  await workspace.getByLabel("Model provider (optional)", { exact: true }).selectOption("")
  await workspace.getByRole("button", { name: "Create isolated workspace", exact: true }).click()
  await expect(environment.getByRole("button", { name: "Register isolated worker", exact: true })).toBeEnabled()
  const registered = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/worker-environments/public-worker/register",
  )
  await environment.getByRole("button", { name: "Register isolated worker", exact: true }).click()
  expect((await registered).request().postDataJSON()).toEqual({})
  await expect(page).toHaveURL(/view=remote/)
})

test("starts a native Claude harness and preserves question input across host refresh", async ({ page }) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  const harness = await mockHarnessOperations(page)
  await page.goto("/agents?view=harness")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  await expect(workspace.getByText("No external CLI sessions on this host yet.", { exact: true })).toBeVisible()
  await expect(workspace.getByRole("button", { name: "Sessions", exact: true })).toHaveCount(0)
  await chooseSearchOption(page, workspace.getByRole("button", { name: /, Coding agent$/ }), "Claude Code")
  await workspace.getByLabel("Checkout directory on this host", { exact: true }).fill(fixture.directory)
  await workspace.getByRole("tab", { name: "Agent setup", exact: true }).click()
  const executable = workspace
    .getByRole("article", { name: "Claude Code", exact: true })
    .getByLabel("Executable name or path", { exact: true })
  await executable.fill("claude-custom")
  await expect(workspace.getByRole("button", { name: "Start harness", exact: true })).toBeHidden()
  await workspace.getByRole("tab", { name: "Sessions", exact: true }).click()
  await expect(workspace.getByLabel("Checkout directory on this host", { exact: true })).toHaveValue(fixture.directory)
  await expect(workspace.getByRole("button", { name: /, Coding agent$/ })).toContainText("Claude Code")
  await workspace.getByRole("tab", { name: "Agent setup", exact: true }).click()
  await expect(executable).toHaveValue("claude-custom")
  await workspace.getByRole("tab", { name: "Sessions", exact: true }).click()
  await page.screenshot({ path: test.info().outputPath("harness-workspace.png"), animations: "disabled" })
  const opened = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/harness/runs" && response.request().method() === "POST",
  )
  await workspace.getByRole("button", { name: "Start harness", exact: true }).click()
  expect((await opened).request().postDataJSON()).toEqual({ driver: "claude", directory: fixture.directory })
  await expect(workspace.getByRole("log", { name: "Harness output" })).toContainText("Native harness output")
  await expect(
    workspace.getByLabel("Delivery", { exact: true }).getByRole("option", { name: "Steer active execution" }),
  ).toHaveCount(0)
  await workspace.getByLabel("Instruction", { exact: true }).fill("Build the implementation")
  await workspace.getByRole("button", { name: "Send instruction", exact: true }).click()
  await expect(workspace.getByLabel("Instruction", { exact: true })).toHaveValue("")
  await expect(workspace.getByRole("alert")).toHaveCount(0)
  const answer = workspace.getByLabel("Which implementation?", { exact: true })
  await answer.fill("Small")
  const refreshed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/harness/runs/native-run" && response.request().method() === "GET",
  )
  await refreshed
  await expect(answer).toBeFocused()
  await expect(answer).toHaveValue("Small")
  const answered = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/native-run/answer"))
  await workspace.getByRole("button", { name: "Submit answers", exact: true }).click()
  expect((await answered).request().postDataJSON()).toEqual({
    request: "question-native",
    allow: true,
    answers: { choice: "Small" },
  })
  await expect(answer).toHaveCount(0)
  await expect(workspace.getByRole("alert")).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath("external-harness.png"), animations: "disabled" })
  await workspace.getByRole("tab", { name: "Agent setup", exact: true }).click()
  await expect(executable).toHaveValue("claude-custom")
  await expect(workspace.getByRole("article", { name: "Native session details", exact: true })).toBeVisible()
  await expect.poll(() => workspace.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0)
  await page.screenshot({ path: test.info().outputPath("harness-agent-setup.png"), animations: "disabled" })
  await workspace.getByRole("tab", { name: "Sessions", exact: true }).click()
  harness.loseProcess()
  await expect(
    workspace.getByRole("checkbox", { name: "I confirmed that the original process is stopped" }),
  ).toBeVisible()
  await expect(workspace.getByRole("button", { name: "Resume native session", exact: true })).toBeDisabled()
  await expect(workspace.getByRole("button", { name: "Record reconciliation", exact: true })).toBeDisabled()
  await workspace.getByRole("checkbox", { name: "I confirmed that the original process is stopped" }).check()
  await workspace.getByRole("button", { name: "Record reconciliation", exact: true }).click()
  await expect(workspace.getByRole("button", { name: "Resume native session", exact: true })).toBeEnabled()
  const closed: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/native-run/close")) closed.push(request.url())
  })
  const inspector = workspace.getByRole("article", { name: "Native session details", exact: true })
  await inspector.getByRole("button", { name: "Close", exact: true }).click()
  await expect(inspector).toBeHidden()
  expect(closed).toEqual([])
  await workspace.getByRole("button", { name: "Open session details", exact: true }).click()
  await expect(inspector.getByRole("button", { name: "Resume native session", exact: true })).toBeEnabled()
})

test.describe("Remote project search on mobile", () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 640 } })
  test("keeps native requests and drafts usable in a dedicated mobile inspector", async ({ page }) => {
    await mockStressTimeline(page)
    await installStressSessionTabs(page, { sessionIDs: [] })
    await mockHarnessOperations(page, { output: "A long native output line\n".repeat(100) })
    const mutations: string[] = []
    page.on("request", (request) => {
      if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/harness/runs"))
        mutations.push(request.method() + " " + new URL(request.url()).pathname)
    })
    await page.goto("/agents?view=harness")
    const workspace = page.getByRole("region", { name: "Agents", exact: true })
    await chooseSearchOption(page, workspace.getByRole("button", { name: /, Coding agent$/ }), "Claude Code")
    await workspace.getByLabel("Checkout directory on this host", { exact: true }).fill(fixture.directory)
    await workspace.getByRole("button", { name: "Start harness", exact: true }).tap()
    const inspector = workspace.getByRole("article", { name: "Native session details", exact: true })
    await expect(inspector).toBeVisible()
    await expect(workspace.getByRole("button", { name: /, Coding agent$/ })).toBeHidden()
    const draft = inspector.getByLabel("Instruction", { exact: true })
    await draft.fill("Build the implementation")
    await inspector.getByRole("button", { name: "Send instruction", exact: true }).tap()
    await inspector.getByRole("button", { name: "Review requests", exact: true }).tap()
    const answer = inspector.getByLabel("Which implementation?", { exact: true })
    await answer.fill("Small")
    const refreshed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/harness/runs/native-run",
    )
    await refreshed
    await expect(answer).toBeFocused()
    await expect(answer).toHaveValue("Small")
    await draft.fill("Keep this unsent instruction")
    await inspector.getByRole("button", { name: "Back to sessions", exact: true }).tap()
    await expect(inspector).toBeHidden()
    const open = workspace.getByRole("button", { name: "Open session details", exact: true })
    await expect(open).toBeFocused()
    await open.tap()
    await expect(draft).toHaveValue("Keep this unsent instruction")
    await expect(answer).toHaveValue("Small")
    await inspector.getByRole("button", { name: "Review requests", exact: true }).tap()
    const dock = page.getByRole("navigation", { name: "Mobile navigation", exact: true })
    for (const size of [
      { width: 390, height: 640 },
      { width: 320, height: 480 },
    ]) {
      await page.setViewportSize(size)
      await expect
        .poll(async () => {
          const panel = await inspector.boundingBox()
          const bar = await dock.boundingBox()
          return !!panel && !!bar && panel.y >= 0 && panel.y + panel.height <= bar.y
        })
        .toBe(true)
      await inspector.getByRole("button", { name: "Review requests", exact: true }).tap()
      await expect(answer).toBeInViewport({ ratio: 1 })
      await expect(inspector.getByRole("button", { name: "Submit answers", exact: true })).toBeInViewport({ ratio: 1 })
    }
    await page.screenshot({ path: test.info().outputPath("mobile-native-requests.png"), animations: "disabled" })
    await page.setViewportSize({ width: 1200, height: 900 })
    await expect(workspace.getByRole("button", { name: /, Coding agent$/ })).toBeVisible()
    await expect(draft).toHaveValue("Keep this unsent instruction")
    await expect(answer).toHaveValue("Small")
    expect(mutations).toEqual(["POST /api/harness/runs", "POST /api/harness/runs/native-run/prompt"])
    const output = inspector.getByRole("log", { name: "Harness output", exact: true })
    await output.press("End")
    await expect
      .poll(() =>
        output.evaluate((element) => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)),
      )
      .toBeLessThanOrEqual(1)
    const scrolled = await output.evaluate((element) => element.scrollTop)
    const read = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/harness/runs/native-run")
    await read
    await expect.poll(() => output.evaluate((element) => element.scrollTop)).toBe(scrolled)
    const sent = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/native-run/answer"))
    await inspector.getByRole("button", { name: "Submit answers", exact: true }).click()
    expect((await sent).request().postDataJSON()).toMatchObject({
      request: "question-native",
      answers: { choice: "Small" },
      allow: true,
    })
    await expect(answer).toHaveCount(0)
    await workspace.getByRole("button", { name: "Start harness", exact: true }).click()
    await expect(draft).toHaveValue("")
    await draft.fill("A separate task")
    await inspector.getByRole("button", { name: "Send instruction", exact: true }).click()
    await expect(answer).toHaveValue("")
  })

  test("changes the Agents section without reopening the drawer or losing the selected host", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await mockStressTimeline(page)
    await installStressSessionTabs(page, { sessionIDs: [] })
    await mockMachineInspection(page)
    await mockHarnessOperations(page)
    const mutations: string[] = []
    page.on("request", (request) => {
      if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/harness"))
        mutations.push(request.url())
    })
    await page.goto(`/agents?view=machines&host=${encodeURIComponent(SERVER)}`)
    const workspace = page.getByRole("region", { name: "Agents", exact: true })
    const section = workspace.getByRole("button", { name: /, Agents section$/ })
    await expect(section).toBeVisible()
    await expect(section).toContainText("Machines")
    const create = workspace.getByRole("button", { name: "New session", exact: true })
    await expect.poll(async () => (await create.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await expect.poll(async () => (await create.boundingBox())!.width).toBeGreaterThanOrEqual(44)
    await expect
      .poll(async () => (await workspace.locator(":scope > div > header").boundingBox())!.height)
      .toBeLessThanOrEqual(80)
    await section.tap()
    await page.getByRole("option", { name: "Executors", exact: true }).tap()
    await expect(section).toContainText("Executors")
    await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("harness")
    expect(new URL(page.url()).searchParams.get("host")).toBe(SERVER)
    await expect(workspace.getByRole("button", { name: /, Coding agent$/ })).toBeVisible()
    await expect.poll(() => workspace.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0)
    await page.screenshot({ path: test.info().outputPath("mobile-agents-sections.png"), animations: "disabled" })
    await section.tap()
    await page.getByRole("dialog").getByRole("combobox").fill("Machines")
    await page.keyboard.press("Escape")
    await expect(section).toBeFocused()
    await expect(section).toContainText("Executors")
    expect(new URL(page.url()).searchParams.get("host")).toBe(SERVER)
    expect(mutations).toEqual([])
    await page.setViewportSize({ width: 1200, height: 900 })
    await expect(section).toBeHidden()
    await expect(workspace.getByRole("heading", { name: "Executors", exact: true })).toBeVisible()
    await expect(
      page
        .getByRole("navigation", { name: "Agents", exact: true })
        .getByRole("button", { name: "Executors", exact: true }),
    ).toHaveAttribute("aria-current", "page")
  })

  test("searches remote projects locally and preserves the choice when search is dismissed", async ({ page }) => {
    await mockStressTimeline(page, {
      projects: [
        ...Array.from({ length: 35 }, (_, index) => ({
          ...fixture.project,
          id: `project_${index}`,
          name: `Project ${index}`,
          canonical: `/srv/project-${index}`,
        })),
        { ...fixture.project, id: "project_cafe", name: "Payments Café", canonical: "/srv/payments" },
      ],
    })
    await installStressSessionTabs(page, { sessionIDs: [] })
    await mockMachineInspection(page)
    await page.goto("/agents?view=machines")
    const workspace = page.getByRole("region", { name: "Agents", exact: true })
    const machine = workspace.getByRole("button", { name: /, Connected machine$/ })
    await machine.tap()
    const machineSearch = page.getByRole("dialog").getByRole("combobox")
    await expect(machineSearch).toBeFocused()
    await machineSearch.fill(new URL(SERVER).host)
    await page.getByRole("option", { name: new RegExp(`^${new URL(SERVER).host.replaceAll(".", "\\.")}`) }).tap()
    await expect(machine).toContainText(new URL(SERVER).host)
    await workspace.getByRole("button", { name: "Continue", exact: true }).tap()
    await workspace.getByRole("button", { name: "Check server", exact: true }).tap()
    await expect(workspace.getByText("Server access verified.", { exact: true })).toBeVisible()
    await workspace.getByRole("button", { name: "Continue", exact: true }).tap()
    const project = workspace.getByRole("button", { name: /, Project on the machine$/ })
    await project.press("ArrowDown")
    const search = page.getByRole("dialog").getByRole("combobox")
    await expect(search).toBeFocused()
    await search.fill("cafe")
    await expect(page.getByRole("option", { name: /Payments Café/ })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath("mobile-project-search-open.png"), animations: "disabled" })
    await search.press("ArrowDown")
    await search.press("Enter")
    await expect(project).toContainText("Payments Café")
    const directory = workspace.getByLabel("Existing checkout directory on the machine", { exact: true })
    await expect(directory).toHaveValue("/srv/payments")
    await project.click()
    await search.fill("not-a-project")
    await expect(page.getByRole("status").filter({ hasText: "No matching options" })).toBeVisible()
    await search.press("Escape")
    await expect(project).toBeFocused()
    await expect(project).toContainText("Payments Café")
    await expect(directory).toHaveValue("/srv/payments")
    await page.screenshot({ path: test.info().outputPath("mobile-project-search.png"), animations: "disabled" })
  })
})

test.describe("Worktree touch review", () => {
  test.use({ hasTouch: true, isMobile: true })
  test("creates and reviews a worktree, targets its harness and archives a detached result", async ({ page }) => {
    await mockStressTimeline(page)
    await installStressSessionTabs(page, { sessionIDs: [] })
    const tree = await mockWorktreeOperations(page, {
      diff: Array.from({ length: 80 }, (_, i) => `+ agent result ${i}: ${"code ".repeat(40)}`).join("\n"),
    })
    const writes: string[] = []
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname
      if (request.method() === "POST" && path.startsWith("/api/worktree")) writes.push(path)
    })
    await mockHarnessOperations(page)
    await page.goto(`/agents?view=worktrees&project=${fixture.project.id}`)
    const workspace = page.getByRole("region", { name: "Agents", exact: true })
    await workspace.getByLabel("Worktree name", { exact: true }).fill("agent-result")
    await workspace.getByRole("button", { name: "Create worktree", exact: true }).click()
    const child = workspace.getByRole("article", { name: tree.directory, exact: true })
    await expect(child).toBeVisible()
    await workspace.getByLabel("Worktree name", { exact: true }).fill("next-worktree-draft")
    await page.setViewportSize({ width: 390, height: 640 })
    const opener = child.getByRole("button", { name: "Review changes", exact: true })
    await opener.click()
    const review = workspace.getByRole("region", { name: "Review changes", exact: true })
    await expect(review).toBeFocused()
    await expect(workspace.getByLabel("Worktree name", { exact: true })).toBeHidden()
    await expect(review.getByText(`Integration target: ${fixture.directory}`, { exact: true })).toBeVisible()
    for (const size of [
      { width: 390, height: 640 },
      { width: 320, height: 480 },
    ]) {
      await page.setViewportSize(size)
      await expect(review.getByRole("button", { name: "Back to worktrees", exact: true })).toBeInViewport({ ratio: 1 })
      await expect(review.getByRole("button", { name: "Integrate reviewed commit", exact: true })).toBeInViewport({
        ratio: 1,
      })
      await expect(review.getByRole("button", { name: "Archive worktree", exact: true })).toBeInViewport({ ratio: 1 })
    }
    const diff = review.getByLabel("Worktree diff", { exact: true })
    await diff.focus()
    await diff.press("Control+End")
    await expect.poll(() => diff.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await expect(review.getByRole("button", { name: "Integrate reviewed commit", exact: true })).toBeInViewport({
      ratio: 1,
    })
    await page.screenshot({ path: test.info().outputPath("mobile-worktree-review.png"), animations: "disabled" })
    await review.getByRole("button", { name: "Back to worktrees", exact: true }).click()
    await expect(opener).toBeFocused()
    await expect(workspace.getByLabel("Worktree name", { exact: true })).toHaveValue("next-worktree-draft")
    expect(writes).toEqual(["/api/worktree", "/api/worktree/inspect"])
    await opener.click()
    await expect(review).toBeFocused()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(workspace.getByLabel("Worktree name", { exact: true })).toBeVisible()
    await expect(workspace.getByLabel("Worktree diff", { exact: true })).toContainText("agent result")
    const integrated = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/worktree/integrate",
    )
    await workspace.getByRole("button", { name: "Integrate reviewed commit", exact: true }).click()
    expect((await integrated).request().postDataJSON()).toEqual({
      projectID: fixture.project.id,
      directory: tree.directory,
      target: fixture.directory,
      head: "a".repeat(40),
      targetHead: "b".repeat(40),
    })
    await workspace.getByRole("button", { name: "Archive worktree", exact: true }).click()
    await page.setViewportSize({ width: 320, height: 480 })
    await expect(review.getByRole("alert")).toBeInViewport()
    await expect(review.getByRole("button", { name: "Confirm archive", exact: true })).toBeInViewport({ ratio: 1 })
    expect(writes.filter((path) => path === "/api/worktree/archive")).toEqual([])
    await review.getByRole("button", { name: "Keep worktree", exact: true }).click()
    await expect(review.getByRole("button", { name: "Confirm archive", exact: true })).toHaveCount(0)
    await review.getByRole("button", { name: "Archive worktree", exact: true }).click()
    await workspace.getByRole("button", { name: "Confirm archive", exact: true }).click()
    await expect(child).toHaveCount(0)
    await expect(workspace.getByRole("button", { name: "Restore as a new worktree", exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath("worktree-cycle.png"), animations: "disabled" })
    await workspace.getByRole("button", { name: "Restore as a new worktree", exact: true }).click()
    await child.getByRole("button", { name: "Start coding agent here", exact: true }).click()
    await expect(workspace.getByLabel("Checkout directory on this host", { exact: true })).toHaveValue(tree.directory)
  })
})

test.describe("Machine touch setup", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  test("machine onboarding retries checks, preserves its mobile draft and blocks an unusable worker route", async ({
    page,
  }) => {
    await mockStressTimeline(page)
    await installStressSessionTabs(page, { sessionIDs: [] })
    const machine = await mockMachineInspection(page)
    const workers = await mockRemoteWorkers(page)
    machine.available = false
    machine.missingDirectory = "/missing/project"
    await page.goto("/agents?view=machines")
    const workspace = page.getByRole("region", { name: "Agents", exact: true })
    const next = workspace.getByRole("button", { name: "Continue", exact: true })
    await expect(next).toBeDisabled()
    const picker = workspace.getByRole("button", { name: /, Connected machine$/ })
    await chooseSearchOption(page, picker, new URL(SERVER).host)
    expect(machine.checks).toHaveLength(0)
    await next.click()
    await expect(workspace.getByRole("heading", { name: "Check access", exact: true })).toBeFocused()
    await expect(next).toBeDisabled()
    await workspace.getByRole("button", { name: "Check server", exact: true }).click()
    await expect(workspace.getByRole("alert")).toContainText("Could not verify this server.")
    await expect(next).toBeDisabled()
    machine.available = true
    await workspace.getByRole("button", { name: "Check server", exact: true }).click()
    await expect(workspace.getByText("Server version:", { exact: false })).toBeVisible()
    expect(machine.checks).toHaveLength(2)
    await next.click()
    const directory = workspace.getByLabel("Existing checkout directory on the machine", { exact: true })
    await directory.fill("/missing/project")
    await workspace.getByRole("button", { name: "Check project", exact: true }).click()
    await expect(workspace.getByRole("alert")).toContainText("Location not found: /missing/project")
    await expect(directory).toHaveValue("/missing/project")
    await expect(
      workspace.getByRole("button", { name: "Code in this project on this machine", exact: true }),
    ).toBeHidden()
    await directory.fill("/home/pi/project")
    await workspace.getByRole("button", { name: "Check project", exact: true }).click()
    await expect(workspace.getByText("Project access verified.", { exact: true })).toBeVisible()
    await workspace.getByRole("button", { name: "Use this project as a worker", exact: true }).click()
    await workspace.getByLabel("Worker name", { exact: true }).fill("pi-a")
    await workspace.getByLabel("Capabilities (comma-separated)", { exact: true }).fill("linux, arm64")
    await workspace.getByRole("button", { name: "Back", exact: true }).click()
    await expect(directory).toHaveValue("/home/pi/project")
    await workspace.getByRole("button", { name: "Back", exact: true }).click()
    await expect(workspace.getByText("Server access verified.", { exact: true })).toBeVisible()
    await next.click()
    await expect(directory).toHaveValue("/home/pi/project")
    await workspace.getByRole("button", { name: "Check project", exact: true }).click()
    await expect(workspace.getByLabel("Worker name", { exact: true })).toHaveValue("pi-a")
    await expect(workspace.getByLabel("Capabilities (comma-separated)", { exact: true })).toHaveValue("linux, arm64")
    expect(machine.checks).toHaveLength(2)
    await expect(workspace.getByRole("button", { name: "Register worker checkout", exact: true })).toBeDisabled()
    await expect(workspace.getByRole("button", { name: "Register worker checkout", exact: true })).toBeInViewport({
      ratio: 1,
    })
    expect(workers.requests.filter((request) => request.method === "POST")).toHaveLength(0)
    await expect(
      workspace.getByText("The coordinator needs a reachable worker address", { exact: false }),
    ).toBeVisible()
    await page.screenshot({ path: test.info().outputPath("machine-onboarding.png"), animations: "disabled" })
  })
})

test("machine onboarding registers the verified checkout with its coordinator credential", async ({ page }) => {
  await mockStressTimeline(page, { projects: [{ ...fixture.project, canonical: fixture.directory }] })
  await mockStressTimeline(page, {
    server: REMOTE_SERVER,
    projects: [{ ...fixture.project, canonical: fixture.directory }],
  })
  await mockMachineInspection(page)
  const workers = await mockRemoteWorkers(page)
  await page.goto(
    `/e2e/utils/settings-wsl.html?${new URLSearchParams({ server: SERVER, mode: "ready", ssh: REMOTE_SERVER, path: "/agents?view=machines" })}`,
  )
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  await workspace.getByRole("button", { name: "Add server", exact: true }).click()
  await page.getByRole("menuitem", { name: "Add SSH server", exact: true }).click()
  const connect = page.getByRole("dialog")
  await connect.getByLabel("Host or SSH command", { exact: true }).fill("filip@10.101.1.105")
  await connect.getByLabel("Server name (optional)", { exact: true }).fill("Strong PC")
  await connect.getByRole("button", { name: "Add server", exact: true }).click()
  await expect(connect).toHaveCount(0)
  await expect(
    workspace.getByText("Connected to Strong PC. Choose how to use this machine below.", { exact: true }),
  ).toBeVisible()
  await workspace.getByRole("button", { name: "Continue", exact: true }).click()
  await workspace.getByRole("button", { name: "Check server", exact: true }).click()
  await expect(workspace.getByText("Server version: fixture", { exact: true })).toBeVisible()
  await workspace.getByRole("button", { name: "Continue", exact: true }).click()
  await chooseSearchOption(
    page,
    workspace.getByRole("button", { name: /, Project on the machine$/ }),
    fixture.project.name,
    fixture.directory,
  )
  await expect(workspace.getByLabel("Existing checkout directory on the machine", { exact: true })).toHaveValue(
    fixture.directory,
  )
  await workspace.getByRole("button", { name: "Check project", exact: true }).click()
  await expect(workspace.getByText("Project access verified.", { exact: true })).toBeVisible()
  await workspace.getByRole("button", { name: "Use this project as a worker", exact: true }).click()
  await expect(workspace.getByLabel("Worker name", { exact: true })).toHaveValue("strong-pc")
  await workspace.getByLabel("Worker name", { exact: true }).fill("pi-a")
  await workspace.getByLabel("Capabilities (comma-separated)", { exact: true }).fill("linux, arm64")
  await workspace.getByRole("button", { name: "Register worker checkout", exact: true }).click()
  await expect(workspace.getByText("Worker checkout registered", { exact: true })).toBeVisible()
  expect(
    workers.requests.find((request) => request.path === "/api/workers" && request.method === "POST")?.body,
  ).toEqual({
    id: "pi-a",
    url: REMOTE_SERVER,
    password: "ssh-2",
    directories: [fixture.directory],
    tags: ["linux", "arm64"],
  })
  await workspace.getByRole("button", { name: "Manage workers on this machine", exact: true }).click()
  await expect(workspace.getByRole("heading", { name: "Remote workers", exact: true, level: 1 })).toBeVisible()
  await expect(
    page.getByRole("complementary", { name: "Agents", exact: true }).getByRole("button", { name: /, Host$/ }),
  ).toContainText("Strong PC")
  await page
    .getByRole("complementary", { name: "Agents", exact: true })
    .getByRole("button", { name: "Machines", exact: true })
    .click()
  await chooseSearchOption(page, workspace.getByRole("button", { name: /, Connected machine$/ }), "box")
  await workspace.getByRole("button", { name: "Continue", exact: true }).click()
  await workspace.getByRole("button", { name: "Check server", exact: true }).click()
  await expect(workspace.getByText("Server version: fixture", { exact: true })).toBeVisible()
  await workspace.getByRole("button", { name: "Continue", exact: true }).click()
  await chooseSearchOption(
    page,
    workspace.getByRole("button", { name: /, Project on the machine$/ }),
    fixture.project.name,
    fixture.directory,
  )
  await workspace.getByRole("button", { name: "Check project", exact: true }).click()
  await workspace.getByRole("button", { name: "Use this project as a worker", exact: true }).click()
  await expect(workspace.getByRole("button", { name: "Register worker checkout", exact: true })).toBeDisabled()
  await expect(
    workspace.getByText(/A desktop loopback forward cannot be registered with a remote coordinator/),
  ).toBeVisible()
  await workspace
    .getByRole("navigation", { name: "Machine setup", exact: true })
    .getByRole("button", { name: "Connect Completed", exact: true })
    .click()
  await chooseSearchOption(page, workspace.getByRole("button", { name: /, Connected machine$/ }), "Strong PC")
  await workspace.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(workspace.getByRole("button", { name: "Continue", exact: true })).toBeDisabled()
  await expect(workspace.getByText("Server access verified.", { exact: true })).toBeHidden()
  await workspace.getByRole("button", { name: "Check server", exact: true }).click()
  await expect(workspace.getByText("Server access verified.", { exact: true })).toBeVisible()
  await workspace.getByRole("button", { name: "Continue", exact: true }).click()
  await chooseSearchOption(
    page,
    workspace.getByRole("button", { name: /, Project on the machine$/ }),
    fixture.project.name,
    fixture.directory,
  )
  await workspace.getByRole("button", { name: "Check project", exact: true }).click()
  await workspace.getByRole("button", { name: "Use this project as a worker", exact: true }).click()
  await workspace.getByLabel("Worker name", { exact: true }).fill("strong-self")
  await expect(workspace.getByRole("button", { name: "Register worker checkout", exact: true })).toBeEnabled()
  await workspace.getByRole("button", { name: "Register worker checkout", exact: true }).click()
  await expect(workspace.getByText("Worker checkout registered", { exact: true })).toBeVisible()
  expect(
    workers.requests
      .filter((request) => request.path === "/api/workers" && request.method === "POST")
      .map((request) => request.body),
  ).toEqual([
    { id: "pi-a", url: REMOTE_SERVER, password: "ssh-2", directories: [fixture.directory], tags: ["linux", "arm64"] },
    { id: "strong-self", url: "http://127.0.0.1:35555", password: "ssh-2", directories: [fixture.directory], tags: [] },
  ])
  await page.screenshot({
    path: test.info().outputPath("remote-coordinator-onboarding.png"),
    animations: "disabled",
    fullPage: true,
  })
  await workspace.getByRole("button", { name: "Back to coding options", exact: true }).click()
  await workspace.getByRole("button", { name: "Code in this project on this machine", exact: true }).click()
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
})

test("sends resource requirements with a worker task and displays its queued reason", async ({ page }) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  const workers = await mockRemoteWorkers(page, {
    workers: [
      {
        worker: {
          id: "pi-a",
          url: "http://192.168.1.50:4096",
          passwordEnv: "credential",
          directories: ["/checkout"],
          tags: ["arm64"],
        },
        connection: "online",
      },
    ],
  })
  await page.goto("/agents?view=remote")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  await workspace.getByLabel("What should the worker do?", { exact: true }).fill("Run resource-aware tests")
  await workspace.getByLabel("Required worker capabilities (optional)", { exact: true }).fill("arm64")
  await workspace.getByRole("button", { name: "Set resource requirements", exact: true }).click()
  await workspace.getByLabel("CPU slots", { exact: true }).fill("2")
  await workspace.getByLabel("RAM budget (GiB)", { exact: true }).fill("1.5")
  await workspace.getByLabel("Maximum CPU usage (%) — optional", { exact: true }).fill("80")
  const submitted = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/workers/batches" && response.request().method() === "POST",
  )
  await workspace.getByRole("button", { name: "Send batch", exact: true }).click()
  const response = await submitted
  expect(response.request().postDataJSON()).toEqual({
    tasks: [
      {
        id: expect.any(String),
        prompt: "Run resource-aware tests",
        tags: ["arm64"],
        resources: { cpu: 2, memoryBytes: 1.5 * 1024 ** 3, maxCpuUtilization: 0.8 },
      },
    ],
  })
  const batch = await response.json()
  workers.update({
    ...batch,
    report: {
      ...batch.report,
      tasks: [{ id: batch.manifest.tasks[0].id, state: "queued", queueReason: "memory-capacity" }],
    },
  })
  await workspace
    .getByRole("article")
    .filter({ has: page.getByText("Run resource-aware tests", { exact: true }) })
    .getByRole("button", { name: "Execution details", exact: true })
    .click()
  await expect(workspace.getByText("Waiting for enough unreserved free RAM.", { exact: true })).toBeVisible()
  await expect(
    workspace
      .getByRole("region", { name: "Task details", exact: true })
      .getByText("CPU: 2 · RAM: 1.50 GiB", { exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("worker-resource-admission.png"), animations: "disabled" })
  const cancelled = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/batch-fixture/control"),
  )
  await workspace.getByRole("button", { name: "Cancel queued task", exact: true }).click()
  expect((await cancelled).request().postDataJSON()).toEqual({ kind: "cancel", task: batch.manifest.tasks[0].id })
  await expect(workspace.getByRole("button", { name: "Cancel queued task", exact: true })).toHaveCount(0)
  await expect(workspace.getByText("Waiting for enough unreserved free RAM.", { exact: true })).toHaveCount(0)
})

test("controls the assigned native worker harness and retains instruction focus across metadata refresh", async ({
  page,
}) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  const workers = await mockWaitingWorker(page, fixture.sessions[2])
  await page.goto("/agents?view=remote")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  const task = workspace.getByRole("article").filter({ has: page.getByText("Review the checkout", { exact: true }) })
  await task.getByRole("button", { name: "Execution details", exact: true }).click()
  const inspector = workspace.getByRole("region", { name: "Task details", exact: true })
  await inspector.getByRole("button", { name: "Send instruction", exact: true }).click()
  const editor = inspector.getByLabel("What should this agent do next?", { exact: true })
  await editor.fill("Run the ARM64 checks")
  const refreshed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/workers" && response.request().method() === "GET",
  )
  await refreshed
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue("Run the ARM64 checks")
  await inspector.getByLabel("Delivery", { exact: true }).selectOption("queue")
  const queued = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/batch-waiting/control"))
  await inspector.getByRole("button", { name: "Send", exact: true }).click()
  expect((await queued).request().postDataJSON()).toEqual({
    kind: "prompt",
    task: "task-review",
    id: expect.stringMatching(/^msg_/),
    text: "Run the ARM64 checks",
    delivery: "queue",
  })
  const interrupted = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/batch-waiting/control"),
  )
  await inspector.getByRole("button", { name: "Interrupt", exact: true }).click()
  expect((await interrupted).request().postDataJSON()).toEqual({ kind: "interrupt", task: "task-review" })
  await expect(inspector.getByText("Interrupted · pi-a", { exact: true })).toBeVisible()
  await expect(inspector.getByRole("button", { name: "Interrupt", exact: true })).toHaveCount(0)
  expect(workers.requests.filter((request) => request.path.endsWith("/control"))).toHaveLength(2)
})

test("does not report an empty inbox when inspection is incomplete or change hosts behind an unavailable selection", async ({
  page,
}) => {
  await mockStressTimeline(page, { attention: { data: [], unavailable: [{ directory: fixture.directory }] } })
  await installStressSessionTabs(page, { sessionIDs: [] })
  await mockRemoteWorkers(page)
  await page.goto("/agents?view=inbox")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  await expect(
    workspace.getByText("Some locations or worker tasks could not be inspected. Their pending requests are unknown."),
  ).toBeVisible()
  await expect(workspace.getByText("No pending requests.", { exact: true })).toHaveCount(0)
  await page.goto("/agents?view=inbox&host=unavailable-host")
  await expect(
    workspace.getByText("The selected host is no longer available. Select another host in the sidemenu."),
  ).toBeVisible()
  await expect(workspace.getByText("Requests on this host", { exact: true })).toHaveCount(0)
})

test.describe("Inbox touch navigation", () => {
  test.use({ hasTouch: true, isMobile: true })
  test("restores the Agents workspace and answers the original worker requests without opening its transcript", async ({
    page,
  }) => {
    const messages: string[] = []
    await mockStressTimeline(page, { onMessages: (request) => messages.push(request.sessionID) })
    await installStressSessionTabs(page, { sessionIDs: [] })
    const workers = await mockWaitingWorker(page, fixture.sessions[2])
    await page.goto("/agents?view=inbox")
    const workspace = page.getByRole("region", { name: "Agents", exact: true })
    const menu = page.getByRole("navigation", { name: "Agents", exact: true })
    await expect(menu.getByRole("button", { name: "Inbox", exact: true })).toHaveAttribute("aria-current", "page")
    await expect(workspace.getByRole("button", { name: /Inspect child navigation · edit/ })).toBeVisible()
    await page.reload()
    await expect(workspace.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible()
    await workspace.getByRole("button", { name: /Inspect child navigation · edit/ }).click()
    const permission = workspace.locator('[data-component="dock-prompt"][data-kind="permission"]')
    await expect(permission.getByText("worker.txt", { exact: true })).toBeVisible()
    const permissionReply = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/batch-waiting/answer") && response.request().method() === "POST",
    )
    await permission.getByRole("button", { name: "Allow once", exact: true }).click()
    expect((await permissionReply).request().postDataJSON()).toEqual({
      kind: "permission",
      task: "task-review",
      requestID: "per_worker_edit",
      decision: "once",
    })
    await expect(permission).toHaveCount(0)
    await expect(workspace.locator('[data-component="dock-prompt"][data-kind="question"]')).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 640 })
    const selected = workspace.getByRole("region", { name: "Selected request", exact: true })
    const original = workspace.getByRole("button", { name: /Inspect child navigation · Worker question/ })
    await original.click()
    await expect(selected).toBeInViewport()
    const question = workspace.locator('[data-component="dock-prompt"][data-kind="question"]')
    await question.getByRole("radio", { name: "Minimal", exact: true }).click()
    // A metadata refresh must retain the selected question and draft answer.
    const refreshed = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/batch-waiting/attention"),
    )
    await workspace
      .getByRole("region", { name: "batch-waiting", exact: true })
      .getByRole("button", { name: "Refresh worker requests", exact: true })
      .click()
    await refreshed
    await expect(
      workspace
        .getByRole("region", { name: "batch-waiting", exact: true })
        .getByRole("button", { name: "Refresh worker requests", exact: true }),
    ).toBeEnabled()
    await expect(question.getByRole("radio", { name: "Minimal", exact: true })).toHaveAttribute("aria-checked", "true")
    await selected.getByRole("button", { name: "Back to requests", exact: true }).click()
    await expect(selected).toBeHidden()
    await expect(original).toBeFocused()
    await original.click()
    await expect(question.getByRole("radio", { name: "Minimal", exact: true })).toHaveAttribute("aria-checked", "true")
    expect(workers.requests.filter((request) => request.path.endsWith("/answer"))).toHaveLength(1)
    await page.screenshot({ path: test.info().outputPath("agents-inbox.png"), animations: "disabled" })
    const questionReply = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/batch-waiting/answer") && response.request().method() === "POST",
    )
    await question.getByRole("button", { name: "Submit", exact: true }).click()
    expect((await questionReply).request().postDataJSON()).toEqual({
      kind: "question",
      task: "task-review",
      formID: "frm_worker_choice",
      answer: { q0: "minimal" },
    })
    await expect(question).toHaveCount(0)
    expect(messages).toEqual([])
    expect(workers.requests.filter((request) => request.path.endsWith("/answer"))).toHaveLength(2)
  })
})

test("inspects only the selected mobile host and stops resource polling when details close", async ({ page }) => {
  await page.clock.install()
  await page.setViewportSize({ width: 390, height: 844 })
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  const fleet = ["pi-a", "pi-b"].map((id) => ({
    worker: {
      id,
      url: "http://10.0.0.11:4096",
      directories: [`/srv/${id}`],
      tags: ["arm64"],
      passwordEnv: "worker-key",
    },
    connection: "online" as const,
  }))
  const workers = await mockRemoteWorkers(page, {
    workers: fleet,
    resources: {
      "pi-a": {
        sampledAt: Date.now(),
        platform: "linux arm64",
        cpu: { count: 4, utilization: 0.25 },
        memory: { freeBytes: 4 * 1024 ** 3, totalBytes: 8 * 1024 ** 3 },
        process: { pid: 42, residentBytes: 512 * 1024 ** 2 },
      },
    },
  })
  await page.goto("/agents?view=hosts")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  const roster = workspace.getByRole("list", { name: "Available hosts", exact: true })
  const search = workspace.getByLabel("Search hosts", { exact: true })
  await expect(roster.getByRole("button").filter({ hasText: "pi-b" })).toBeVisible()
  await search.fill("pi-a")
  const row = roster.getByRole("button").filter({ hasText: "pi-a" })
  await expect(roster.getByRole("button")).toHaveCount(1)
  expect(workers.requests.filter((request) => request.path.endsWith("/resources"))).toHaveLength(0)
  await row.click()
  const inspector = workspace.getByRole("region", { name: "Host details", exact: true })
  await expect(inspector).toBeFocused()
  await expect(inspector.getByText("4.00 GiB / 8.00 GiB", { exact: true })).toBeVisible()
  await expect(inspector.getByText("25%", { exact: true })).toBeVisible()
  await expect(inspector.getByRole("meter", { name: "CPU usage", exact: true })).toHaveAttribute("aria-valuenow", "25")
  await expect(inspector.getByRole("meter", { name: "RAM available / limit", exact: true })).toHaveAttribute(
    "aria-valuenow",
    "50",
  )
  await expect(search).toBeHidden()
  expect(
    workers.requests.filter((request) => request.path.endsWith("/resources")).map((request) => request.path),
  ).toEqual(["/api/workers/pi-a/resources"])
  await page.screenshot({ path: test.info().outputPath("mobile-host-inspector.png"), animations: "disabled" })
  await inspector.getByRole("button", { name: "Back to hosts", exact: true }).click()
  await expect(row).toBeFocused()
  await expect(search).toHaveValue("pi-a")
  const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/workers")
  await page.clock.fastForward(15_000)
  await refreshed
  expect(workers.requests.filter((request) => request.path.endsWith("/resources"))).toHaveLength(1)
  await row.click()
  await expect(inspector.getByText("4.00 GiB / 8.00 GiB", { exact: true })).toBeVisible()
  const removed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/workers")
  workers.setWorkers(fleet.filter((worker) => worker.worker.id !== "pi-a"))
  await page.clock.fastForward(5_000)
  await removed
  await expect(inspector.getByRole("alert")).toContainText("This host is no longer in the registry.")
  await expect(inspector.getByText("4.00 GiB / 8.00 GiB", { exact: true })).toHaveCount(0)
  await expect(inspector.getByRole("heading", { name: /^pi-a/ })).toBeVisible()
})

test.describe("Worker execution inspector on mobile", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  test("keeps the original assignment and instruction draft across details, filtering and recovery", async ({
    page,
  }) => {
    const messages: string[] = []
    await mockStressTimeline(page, { onMessages: (request) => messages.push(request.sessionID) })
    await installStressSessionTabs(page, { sessionIDs: [] })
    const workers = await mockWorkerTaskInspection(page)
    await page.goto("/agents?view=remote")
    const workspace = page.getByRole("region", { name: "Agents", exact: true })
    const overview = workspace.getByRole("region", { name: "Batch overview: batch-inspection", exact: true })
    await expect(overview.getByText("0 / 2 completed", { exact: true })).toBeVisible()
    await expect(overview.getByText("Distribution map", { exact: true })).toHaveCount(0)
    const segment = overview
      .getByRole("article")
      .filter({ has: page.getByText("Build docs", { exact: true }) })
      .getByRole("button", { name: "Execution details", exact: true })
    await segment.click()
    const taskDetails = workspace.getByRole("region", { name: "Task details", exact: true })
    await expect(taskDetails.getByText("Not assigned", { exact: true })).toBeVisible()
    await taskDetails.getByRole("button", { name: "Back to tasks", exact: true }).click()
    await expect(segment).toBeFocused()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true)
    await page.screenshot({ path: test.info().outputPath("mobile-worker-summary.png"), animations: "disabled" })
    const search = workspace.getByLabel("Search tasks", { exact: true })
    await search.fill("review arm")
    await chooseSearchOption(page, workspace.getByRole("button", { name: /, Task status$/ }), "Needs your input")
    const row = workspace.getByRole("article").filter({ has: page.getByText("Review ARM checkout", { exact: true }) })
    const opener = row.getByRole("button", { name: "Execution details", exact: true })
    await opener.click()
    const inspector = workspace.getByRole("region", { name: "Task details", exact: true })
    await expect(inspector).toBeFocused()
    await inspector.getByRole("button", { name: "Send instruction", exact: true }).click()
    await inspector.getByLabel("What should this agent do next?", { exact: true }).fill("Keep the original assignment")
    await inspector.getByLabel("Delivery", { exact: true }).selectOption("queue")
    await expect(search).toBeHidden()
    await expect(inspector.getByText("pi-requested", { exact: true })).toBeVisible()
    await expect(inspector.getByText("/srv/review", { exact: true })).toBeVisible()
    await expect(inspector.getByText("configured-provider/requested-model", { exact: true })).toBeVisible()
    await inspector.getByText("Execution identifiers", { exact: true }).click()
    await expect(inspector.getByText("ses_assigned", { exact: true })).toBeVisible()
    const editor = inspector.getByLabel("What should this agent do next?", { exact: true })
    await expect(editor).toHaveValue("Keep the original assignment")
    await expect(inspector.getByLabel("Delivery", { exact: true })).toHaveValue("queue")
    const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/workers")
    await editor.fill("Keep the original assignment and run ARM checks")
    await refreshed
    await expect(editor).toBeFocused()
    await expect(editor).toHaveValue("Keep the original assignment and run ARM checks")
    expect(workers.requests.filter((request) => request.method === "POST")).toHaveLength(0)
    await inspector.getByRole("button", { name: "Back to tasks", exact: true }).click()
    await expect(opener).toBeFocused()
    await expect(search).toHaveValue("review arm")
    await expect(row.getByLabel("What should this agent do next?", { exact: true })).toHaveCount(0)
    await opener.click()
    await expect(editor).toHaveValue("Keep the original assignment and run ARM checks")
    await inspector.getByText("Execution identifiers", { exact: true }).click()
    await expect(inspector.getByText("ses_assigned", { exact: true })).toBeVisible()
    const sent = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/workers/batches/batch-inspection/control",
    )
    await inspector.getByRole("button", { name: "Send", exact: true }).click()
    expect((await sent).request().postDataJSON()).toEqual({
      kind: "prompt",
      task: "task-review",
      id: expect.stringMatching(/^msg_/),
      text: "Keep the original assignment and run ARM checks",
      delivery: "queue",
    })
    await expect(editor).toBeHidden()
    workers.update({
      ...workers.batch,
      observing: false,
      report: {
        fingerprint: "fixture",
        tasks: [{ ...workers.batch.report!.tasks[0], state: "unknown", recoveryReason: "lease-lost" }],
      },
    })
    await expect(inspector.getByText("Connection or admission unconfirmed · pi-a", { exact: true })).toBeVisible()
    await expect(inspector.getByRole("button", { name: "Recover on the original worker", exact: true })).toBeEnabled()
    await page.screenshot({ path: test.info().outputPath("mobile-task-inspector.png"), animations: "disabled" })
    const recovered = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/workers/batches/batch-inspection/recover",
    )
    await inspector.getByRole("button", { name: "Recover on the original worker", exact: true }).click()
    expect((await recovered).request().postDataJSON()).toEqual({ task: "task-review" })
    await expect(inspector.getByText("Running · pi-a", { exact: true })).toBeVisible()
    await expect(inspector.getByText("ses_assigned", { exact: true })).toBeVisible()
    await inspector.getByRole("button", { name: "Back to tasks", exact: true }).click()
    await expect(search).toBeFocused()
    await expect(row).toHaveCount(0)
    await expect(workspace.getByText("Review another checkout", { exact: true })).toBeVisible()
    await search.fill("not-a-task")
    await expect(workspace.getByRole("status").filter({ hasText: "No tasks match these filters." })).toBeVisible()
    await search.fill("")
    await chooseSearchOption(page, workspace.getByRole("button", { name: /, Task status$/ }), "Not reported")
    const unreported = workspace.getByRole("article").filter({ has: page.getByText("Build docs", { exact: true }) })
    await unreported.getByRole("button", { name: "Execution details", exact: true }).click()
    await expect(inspector.getByText("Not assigned", { exact: true })).toBeVisible()
    await expect(inspector.getByRole("button", { name: "Cancel queued task", exact: true })).toHaveCount(0)
    expect(messages).toEqual([])
    expect(workers.requests.filter((request) => request.method === "POST")).toHaveLength(2)
  })
})

test("maps only recorded worker assignments and shares task selection without dispatching", async ({ page }) => {
  const messages: string[] = []
  await mockStressTimeline(page, { onMessages: (request) => messages.push(request.sessionID) })
  await installStressSessionTabs(page, { sessionIDs: [] })
  const workers = await mockWorkerDistribution(page)
  await page.goto("/agents?view=remote")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  const overview = workspace.getByRole("region", { name: "Batch overview: batch-distribution", exact: true })
  await expect(overview.getByText("1 / 6 completed", { exact: true })).toBeVisible()
  await expect(overview.getByRole("article")).toHaveCount(6)
  await expect(workspace.getByLabel("What should the worker do?", { exact: true })).toBeHidden()
  const search = workspace.getByLabel("Search tasks", { exact: true })
  await search.fill("no matching task")
  await expect(workspace.getByText("No tasks match these filters.", { exact: true })).toBeVisible()
  await workspace.getByRole("button", { name: "Clear task filters", exact: true }).click()
  await expect(search).toBeFocused()
  await expect(search).toHaveValue("")
  await expect(overview.getByRole("article")).toHaveCount(6)
  const assigned = overview.getByRole("region", { name: /^pi-a/ })
  await expect(assigned.getByText("Online", { exact: true })).toBeVisible()
  await expect(overview.getByRole("region", { name: "pi-requested", exact: true })).toHaveCount(0)
  const unassigned = overview.getByRole("region", { name: "Not assigned", exact: true })
  await expect(unassigned.getByText("Document the API", { exact: true })).toBeVisible()
  await expect(unassigned.getByText("Review the documentation", { exact: true })).toBeVisible()
  await expect(
    overview.getByRole("region", { name: "pi-b", exact: true }).getByText("Offline", { exact: true }),
  ).toBeVisible()
  const opener = assigned
    .getByRole("article")
    .filter({ has: page.getByText("Implement the API", { exact: true }) })
    .getByRole("button", { name: "Execution details", exact: true })
  await opener.click()
  const inspector = workspace.getByRole("region", { name: "Task details", exact: true })
  await expect(inspector.getByText("/srv/api", { exact: true })).toBeVisible()
  await expect(opener).toHaveAttribute("aria-pressed", "true")
  await inspector.getByRole("button", { name: "Send instruction", exact: true }).click()
  const editor = inspector.getByLabel("What should this agent do next?", { exact: true })
  await editor.fill("Keep this instruction draft")
  workers.update({
    ...workers.batch,
    report: {
      ...workers.batch.report!,
      tasks: workers.batch.report!.tasks.map((entry) =>
        entry.id === "test-api" ? { ...entry, state: "succeeded" } : entry,
      ),
    },
  })
  await expect(overview.getByText("2 / 6 completed", { exact: true })).toBeVisible()
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue("Keep this instruction draft")
  await workspace.getByRole("tab", { name: "Workers", exact: true }).click()
  await expect(overview).toBeHidden()
  await expect(workspace.getByRole("button", { name: "Add worker", exact: true })).toBeDisabled()
  await workspace.getByRole("tab", { name: "Tasks", exact: true }).click()
  await expect(editor).toHaveValue("Keep this instruction draft")
  workers.setWorkers([workers.workers[0]])
  await expect(
    overview
      .getByRole("region", { name: "pi-b", exact: true })
      .getByText("Worker absent from registry", { exact: true }),
  ).toBeVisible()
  await overview.scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath("desktop-worker-distribution.png"), animations: "disabled" })
  await inspector.getByRole("button", { name: "Back to tasks", exact: true }).click()
  await expect(opener).toBeFocused()
  await overview.getByRole("button", { name: "List", exact: true }).click()
  await expect(overview.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(overview.getByRole("button", { name: "By worker", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  )
  await expect(overview.getByRole("article")).toHaveCount(6)
  await overview
    .getByRole("article")
    .filter({ has: page.getByText("Document the API", { exact: true }) })
    .getByRole("button", { name: "Execution details", exact: true })
    .click()
  await expect(inspector.getByText("Not assigned", { exact: true })).toBeVisible()
  workers.setAvailable(false)
  await expect(overview.getByRole("status")).toHaveText(
    "Last known report. Refresh the coordinator to see current task states.",
  )
  await expect(inspector.getByRole("button", { name: "Cancel queued task", exact: true })).toBeDisabled()
  workers.setAvailable(true)
  workers.update({
    ...workers.batch,
    report: {
      ...workers.batch.report!,
      tasks: workers.batch.report!.tasks.map((entry) => ({ ...entry, state: "succeeded" })),
    },
  })
  await expect(overview.getByText("5 / 6 completed", { exact: true })).toBeVisible()
  await workspace.getByRole("tab", { name: "Workers", exact: true }).click()
  await expect(workspace.getByRole("button", { name: "Add worker", exact: true })).toBeDisabled()
  expect(
    workers.requests.filter((request) => request.method === "POST" || request.path.endsWith("/resources")),
  ).toEqual([])
  expect(messages).toEqual([])
})

test("blocks stale task controls and preserves a removed inspector selection", async ({ page }) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  const workers = await mockWorkerTaskInspection(page)
  await page.goto("/agents?view=remote")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  const row = workspace.getByRole("article").filter({ has: page.getByText("Review ARM checkout", { exact: true }) })
  await row.getByRole("button", { name: "Execution details", exact: true }).click()
  const inspector = workspace.getByRole("region", { name: "Task details", exact: true })
  await expect(inspector.getByRole("button", { name: "Interrupt", exact: true })).toBeEnabled()
  await inspector.getByRole("button", { name: "Send instruction", exact: true }).click()
  await inspector.getByLabel("What should this agent do next?", { exact: true }).fill("Draft for the original batch")
  const other = workspace
    .getByRole("article")
    .filter({ has: page.getByText("Review another checkout", { exact: true }) })
  await other.getByRole("button", { name: "Execution details", exact: true }).click()
  await expect(inspector).toBeFocused()
  await expect(inspector.getByText("/srv/other", { exact: true })).toBeVisible()
  await expect(inspector.getByLabel("What should this agent do next?", { exact: true })).toHaveCount(0)
  await row.getByRole("button", { name: "Execution details", exact: true }).click()
  await expect(inspector.getByLabel("What should this agent do next?", { exact: true })).toHaveValue(
    "Draft for the original batch",
  )
  workers.setAvailable(false)
  await expect(inspector.getByRole("alert")).toContainText("The coordinator report could not be refreshed.")
  await expect(inspector.getByRole("button", { name: "Interrupt", exact: true })).toBeDisabled()
  await expect(inspector.getByRole("button", { name: "Send instruction", exact: true })).toBeDisabled()
  const retried = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/workers")
  await inspector.getByRole("button", { name: "Try again", exact: true }).click()
  await retried
  await expect(inspector.getByRole("button", { name: "Interrupt", exact: true })).toBeDisabled()
  workers.setAvailable(true)
  await expect(inspector.getByRole("button", { name: "Interrupt", exact: true })).toBeEnabled()
  workers.setBatches([workers.otherBatch])
  await expect(inspector.getByRole("alert")).toHaveText(
    "This task is no longer in the coordinator report. Return to the task list to choose another.",
  )
  await expect(inspector.getByText("task-review", { exact: true })).toBeVisible()
  await expect(inspector.getByRole("button", { name: "Interrupt", exact: true })).toHaveCount(0)
  await inspector.getByRole("button", { name: "Back to tasks", exact: true }).click()
  await expect(workspace.getByLabel("Search tasks", { exact: true })).toBeFocused()
  expect(workers.requests.filter((request) => request.method === "POST")).toHaveLength(0)
})

test("shows unknown initial CPU usage and hides stale resources after a failed refresh", async ({ page }) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  await mockRemoteWorkers(page)
  await page.goto("/agents?view=hosts")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  const host = workspace.getByRole("article", { name: "Coordinator host", exact: true })
  await expect(host.getByRole("slider", { name: "Explore Memory (GiB)", exact: true }).locator("svg")).toBeVisible()
  await host.getByRole("button", { name: "Pause charts", exact: true }).click()
  await expect(host.getByRole("button", { name: "Resume live charts", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await host.getByRole("button", { name: "Resume live charts", exact: true }).click()
  await expect(host.getByText("Collecting CPU sample", { exact: true })).toBeVisible()
  await expect(host.getByRole("meter", { name: "CPU usage", exact: true })).toHaveCount(0)
  await expect(host.getByText("6.00 GiB / 8.00 GiB", { exact: true })).toBeVisible()
  await expect(host.getByRole("meter", { name: "RAM available / limit", exact: true })).toHaveAttribute(
    "aria-valuenow",
    "75",
  )
  await page.screenshot({ path: test.info().outputPath("host-resource-meters.png"), animations: "disabled" })
  const failed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/resources" && response.status() === 503,
  )
  await page.route("**/api/resources", (route) => route.fulfill({ status: 503, json: { message: "Offline" } }))
  await failed
  await expect(host.getByText("Host resources are unavailable. Previous measurements are not live.")).toBeVisible()
  await expect(host.getByText("6.00 GiB / 8.00 GiB", { exact: true })).toHaveCount(0)
  await expect(host.getByRole("meter")).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath("agents-hosts.png"), animations: "disabled" })
})

test("explains unconfirmed worker execution and recovers the saved assignment without loading its conversation", async ({
  page,
}) => {
  const messages: string[] = []
  const prompts: string[] = []
  await mockStressTimeline(page, {
    onMessages: (request) => messages.push(request.sessionID),
    onPrompt: (input) => prompts.push(input.sessionID),
  })
  await installStressSessionTabs(page, { sessionIDs: [] })
  const batch: Worker.Batch = {
    id: "batch-recovery",
    createdAt: "2026-10-15T00:00:00Z",
    observing: false,
    manifest: { tasks: [{ id: "task-unconfirmed", prompt: "Check the original admission" }] },
    report: {
      fingerprint: "fixture",
      tasks: [
        {
          id: "task-unconfirmed",
          state: "unknown",
          worker: "pi-a",
          directory: "/home/pi/project",
          sessionID: "ses_original",
          messageID: "msg_original",
          recoveryReason: "lease-lost",
          lease: Schema.decodeUnknownSync(WorkerLease.Info)({
            directory: "/home/pi/project",
            owner: "original-task",
            holder: "original-coordinator",
            sessionID: "ses_original",
            messageID: "msg_original",
            generation: 1,
            expiresAt: 1,
            remainingMs: 0,
          }),
        },
      ],
    },
  }
  const workers = await mockRemoteWorkers(page, { batches: [batch] })
  await page.goto("/agents?view=remote")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  await workspace
    .getByRole("article")
    .filter({ has: page.getByText("Check the original admission", { exact: true }) })
    .getByRole("button", { name: "Execution details", exact: true })
    .click()
  const task = workspace.getByRole("region", { name: "Task details", exact: true })
  await expect(task.getByRole("status")).toHaveText(
    "Coordinator access could not be renewed. Work may still be running; the checkout stays reserved. Recover on the original worker.",
  )
  await expect(task.getByRole("button", { name: "Review changes", exact: true })).toHaveCount(0)
  await expect(task.getByText("Checkout reserved · generation 1", { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("worker-recovery.png"), animations: "disabled" })
  const recovered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/workers/batches/batch-recovery/recover" &&
      response.request().method() === "POST",
  )
  await task.getByRole("button", { name: "Recover on the original worker", exact: true }).click()
  const response = await recovered
  expect(response.request().postDataJSON()).toEqual({ task: "task-unconfirmed" })
  expect((await response.json()).report.tasks[0]).toMatchObject({
    worker: "pi-a",
    sessionID: "ses_original",
    messageID: "msg_original",
  })
  await expect(task.getByText("Running · pi-a", { exact: true })).toBeVisible()
  await expect(task.getByText("Checkout reserved · generation 2", { exact: true })).toBeVisible()
  await expect(task.getByRole("status")).toHaveCount(0)
  expect(messages).toEqual([])
  expect(prompts).toEqual([])
  expect(workers.requests.filter((request) => request.method === "POST")).toHaveLength(1)
  await page.screenshot({ path: test.info().outputPath("worker-recovered.png"), animations: "disabled" })
})

test.describe("Worker touch review", () => {
  test.use({ hasTouch: true, isMobile: true })
  test("reviews each draft's saved routing and resources without replacing a missing worker", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 })
    await mockStressTimeline(page)
    await installStressSessionTabs(page, { sessionIDs: [] })
    const fleet: Worker.Status[] = [
      {
        worker: {
          id: "pi-a",
          url: "http://192.168.1.50:4096",
          passwordEnv: "credential",
          directories: ["/home/pi/checkout"],
          tags: ["linux", "arm64"],
        },
        connection: "online",
      },
      {
        worker: {
          id: "build-pc",
          url: "http://192.168.1.51:4096",
          passwordEnv: "credential",
          directories: ["/srv/build"],
          tags: ["linux", "x64"],
        },
        connection: "online",
      },
    ]
    const workers = await mockRemoteWorkers(page, { workers: fleet })
    await page.goto("/agents?view=remote")
    const workspace = page.getByRole("region", { name: "Agents", exact: true })
    const form = workspace.getByRole("form", { name: "Compose a task batch", exact: true })
    const prompt = form.getByLabel("What should the worker do?", { exact: true })
    const target = form.getByRole("button", { name: /, Run on$/ })
    await expect(target).toContainText("Any available worker")
    await prompt.fill("Build ARM package")
    await target.click()
    const search = page.getByRole("dialog").getByRole("combobox")
    await search.fill("arm64")
    const metadata = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/workers" && response.request().method() === "GET",
    )
    workers.setWorkers(fleet.map((worker) => ({ ...worker, platform: "linux" })))
    await metadata
    await expect(search).toBeFocused()
    await expect(search).toHaveValue("arm64")
    await page.getByRole("option", { name: /^pi-a/ }).click()
    await expect(search).toBeHidden()
    await expect(target).toContainText("pi-a")
    await form.getByLabel("Required worker capabilities (optional)", { exact: true }).fill("linux, arm64")
    await form.getByRole("button", { name: "Set resource requirements", exact: true }).click()
    await form.getByLabel("CPU slots", { exact: true }).fill("2")
    await form.getByLabel("RAM budget (GiB)", { exact: true }).fill("1.5")
    await form.getByLabel("Maximum CPU usage (%) — optional", { exact: true }).fill("80")
    const load = form.getByLabel("Maximum CPU usage (%) — optional", { exact: true })
    await expect(load).toBeInViewport({ ratio: 1 })
    const loadBounds = await load.boundingBox()
    const sendBounds = await form.getByRole("button", { name: "Send batch", exact: true }).boundingBox()
    expect(loadBounds!.y + loadBounds!.height).toBeLessThanOrEqual(sendBounds!.y)
    const send = form.getByRole("button", { name: "Send batch", exact: true })
    await expect(send).toBeInViewport({ ratio: 1 })
    await form.getByRole("button", { name: "Add to batch", exact: true }).click()
    const drafts = form.getByRole("region", { name: "Draft tasks", exact: true })
    const arm = drafts.getByRole("article", { name: "Build ARM package", exact: true })
    await expect(arm).toContainText("Run on: pi-a")
    await expect(arm).toContainText("Required capabilities: linux, arm64")
    await expect(arm).toContainText("CPU: 2 · RAM: 1.50 GiB")
    await expect(arm).toContainText("Maximum CPU usage: 80%")
    await chooseSearchOption(page, target, "Any available worker")
    await form.getByLabel("Required worker capabilities (optional)", { exact: true }).fill("")
    await form.getByRole("button", { name: "Set resource requirements", exact: true }).click()
    await prompt.fill("Discard me")
    await form.getByRole("button", { name: "Add to batch", exact: true }).click()
    await drafts.getByRole("button", { name: "Remove task: Discard me", exact: true }).click()
    await expect(drafts.getByRole("article")).toHaveCount(1)
    await prompt.fill("Review docs")
    await form.getByRole("button", { name: "Add to batch", exact: true }).click()
    await expect(drafts.getByRole("heading", { name: "2 tasks in this batch", exact: true })).toBeVisible()
    const docs = drafts.getByRole("article", { name: "Review docs", exact: true })
    await expect(docs).toContainText("Run on: Any available worker")
    await expect(docs).not.toContainText("CPU:")
    await expect(arm).toContainText("CPU: 2 · RAM: 1.50 GiB")
    await chooseSearchOption(page, target, "pi-a", "/home/pi/checkout")
    const removed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/workers" && response.request().method() === "GET",
    )
    workers.setWorkers([])
    await removed
    await expect(arm.getByRole("status")).toContainText("Worker pi-a is no longer registered.")
    await expect(target).toContainText("pi-a")
    await expect(drafts.getByRole("article")).toHaveCount(2)
    await expect(send).toBeDisabled()
    expect(workers.requests.filter((request) => request.method === "POST")).toEqual([])
    const restored = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/workers" && response.request().method() === "GET",
    )
    workers.setWorkers(fleet)
    await restored
    await expect(arm.getByRole("status")).toHaveCount(0)
    await expect(send).toBeEnabled()
    await arm.scrollIntoViewIfNeeded()
    await expect(send).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: test.info().outputPath("mobile-worker-batch.png"), animations: "disabled" })
    const dispatched = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/workers/batches" && response.request().method() === "POST",
    )
    await send.click()
    expect((await dispatched).request().postDataJSON()).toEqual({
      tasks: [
        {
          id: expect.any(String),
          prompt: "Build ARM package",
          worker: "pi-a",
          tags: ["linux", "arm64"],
          resources: { cpu: 2, memoryBytes: 1.5 * 1024 ** 3, maxCpuUtilization: 0.8 },
        },
        { id: expect.any(String), prompt: "Review docs" },
      ],
    })
    await expect(drafts).toHaveCount(0)
    await workspace.getByRole("tab", { name: "New batch", exact: true }).click()
    await expect(prompt).toHaveValue("")
    expect(workers.requests.filter((request) => request.method === "POST")).toHaveLength(1)
  })

  test("registers remote workers, sends an independent task batch and downloads reviewed changes", async ({ page }) => {
    await mockStressTimeline(page)
    await installStressSessionTabs(page, { sessionIDs: [] })
    const workers = await mockRemoteWorkers(page)
    await page.goto("/")
    await page.getByRole("button", { name: "Agents", exact: true }).click()
    const dialog = page.getByRole("region", { name: "Agents", exact: true })
    await page
      .getByRole("navigation", { name: "Agents", exact: true })
      .getByRole("button", { name: "Remote workers", exact: true })
      .click()
    await expect(
      dialog
        .getByRole("tabpanel", { name: "Workers", exact: true })
        .getByText("Connect a machine to start sending tasks."),
    ).toBeVisible()
    await page.setViewportSize({ width: 320, height: 480 })
    const add = dialog.getByRole("button", { name: "Add worker", exact: true })
    await add.click()
    const connection = dialog.getByRole("form", { name: "Connect a worker", exact: true })
    await expect(connection).toBeFocused()
    await connection.getByLabel("Server password or pairing token", { exact: true }).fill("discarded-fixture-secret")
    await expect(connection.getByRole("button", { name: "Connect worker", exact: true })).toBeInViewport({ ratio: 1 })
    await expect(connection.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport({ ratio: 1 })
    await connection.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(add).toBeFocused()
    expect(workers.requests.filter((request) => request.method === "POST")).toEqual([])
    await add.click()
    await expect(connection.getByLabel("Server password or pairing token", { exact: true })).toHaveValue("")
    await dialog.getByLabel("Worker name", { exact: true }).fill("pi-a")
    await dialog.getByLabel("Server address", { exact: true }).fill("http://192.168.1.50:4096")
    await dialog.getByLabel("Project directory on the worker", { exact: true }).fill("/home/pi/project")
    await dialog.getByLabel("Server password or pairing token", { exact: true }).fill("fixture-secret")
    await dialog.getByText("Advanced worker settings", { exact: true }).click()
    await dialog.getByLabel("Capabilities, separated by commas", { exact: true }).fill("linux, arm64")
    await expect(connection.getByRole("button", { name: "Connect worker", exact: true })).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: test.info().outputPath("mobile-worker-connection.png"), animations: "disabled" })
    await dialog.getByRole("button", { name: "Connect worker", exact: true }).click()
    await page.setViewportSize({ width: 1440, height: 900 })
    await dialog.getByRole("tab", { name: "Workers", exact: true }).click()
    await expect(dialog.getByRole("heading", { name: "pi-a · Connected", exact: true })).toBeVisible()
    expect(
      workers.requests.find((request) => request.path === "/api/workers" && request.method === "POST")?.body,
    ).toEqual({
      id: "pi-a",
      url: "http://192.168.1.50:4096",
      directories: ["/home/pi/project"],
      password: "fixture-secret",
      tags: ["linux", "arm64"],
    })
    await expect(dialog.getByLabel("Server password or pairing token", { exact: true })).toHaveCount(0)
    await dialog.getByRole("tab", { name: "New batch", exact: true }).click()
    await dialog.getByLabel("What should the worker do?", { exact: true }).fill("Review Linux compatibility")
    await chooseSearchOption(page, dialog.getByRole("button", { name: /, Run on$/ }), "pi-a", "arm64")
    await dialog.getByRole("button", { name: "Add to batch", exact: true }).click()
    await dialog.getByLabel("What should the worker do?", { exact: true }).fill("Run the test suite")
    await dialog.getByRole("button", { name: "Send batch", exact: true }).click()
    await expect(
      dialog
        .getByRole("tabpanel", { name: "Tasks", exact: true })
        .getByRole("article")
        .getByText("Completed", { exact: true }),
    ).toHaveCount(2)
    expect(
      workers.requests.filter((request) => request.path === "/api/workers/batches").map((request) => request.body),
    ).toEqual([
      {
        tasks: [
          { id: expect.any(String), prompt: "Review Linux compatibility", worker: "pi-a" },
          { id: expect.any(String), prompt: "Run the test suite", worker: "pi-a" },
        ],
      },
    ])
    const task = dialog.getByRole("article").filter({ has: page.getByText("Run the test suite", { exact: true }) })
    await dialog.getByRole("tab", { name: "New batch", exact: true }).click()
    await dialog.getByLabel("What should the worker do?", { exact: true }).fill("Follow-up draft")
    await dialog.getByRole("tab", { name: "Tasks", exact: true }).click()
    await task.getByRole("button", { name: "Execution details", exact: true }).click()
    await page.setViewportSize({ width: 390, height: 640 })
    const opener = dialog
      .getByRole("region", { name: "Task details", exact: true })
      .getByRole("button", { name: "Review changes", exact: true })
    await opener.click()
    const review = dialog.getByRole("region", { name: "Collected changes", exact: true })
    await expect(review).toBeFocused()
    await expect(review.getByText("Run the test suite", { exact: true })).toBeVisible()
    await expect(dialog.getByLabel("What should the worker do?", { exact: true })).toBeHidden()
    await review.getByRole("button", { name: "Back to tasks", exact: true }).click()
    await expect(opener).toBeFocused()
    await expect(dialog.getByLabel("What should the worker do?", { exact: true })).toHaveValue("Follow-up draft")
    const collected = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/collect"))
    await opener.click()
    const taskID = (await collected).request().postDataJSON().task
    await expect(review).toContainText(`Task: ${taskID} · Worker: pi-a`)
    await expect(review).toBeFocused()
    await expect(dialog.getByRole("heading", { name: "Collected changes", exact: true })).toBeVisible()
    await dialog.getByText("result.txt (+1 / −0)", { exact: true }).click()
    await expect(dialog.getByText(workers.patch, { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 320, height: 480 })
    await expect(review.getByRole("button", { name: "Back to tasks", exact: true })).toBeInViewport({ ratio: 1 })
    await expect(review.getByRole("button", { name: "Download patch", exact: true })).toBeInViewport({ ratio: 1 })
    await review.getByLabel("result.txt", { exact: true }).focus()
    const refreshed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/workers" && response.request().method() === "GET",
    )
    await refreshed
    await expect(review.getByLabel("result.txt", { exact: true })).toBeFocused()
    await expect(dialog.getByText(workers.patch, { exact: true })).toBeVisible()
    const download = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "Download patch", exact: true }).click()
    expect((await download).suggestedFilename()).toBe(`${taskID}.patch`)
    expect(workers.requests.filter((request) => request.path === "/api/workers/batches")).toHaveLength(1)
    await page.screenshot({ path: test.info().outputPath("mobile-worker-review.png"), animations: "disabled" })
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(dialog.getByLabel("What should the worker do?", { exact: true })).toBeHidden()
    await expect(review).toBeVisible()
    await review.getByRole("button", { name: "Back to tasks", exact: true }).click()
    await dialog.getByRole("tab", { name: "New batch", exact: true }).click()
    await expect(dialog.getByLabel("What should the worker do?", { exact: true })).toHaveValue("Follow-up draft")
  })
})
// The fleet must expose the child that needs the user without loading either transcript.
test("manages a parallel session tree without opening its conversation", async ({ page }) => {
  const messages: string[] = []
  const prompts: { sessionID: string; body: object }[] = []
  const interrupts: string[] = []
  page.on("request", (request) => {
    const match = new URL(request.url()).pathname.match(/\/api\/session\/([^/]+)\/interrupt$/)
    if (match && request.method() === "POST") interrupts.push(match[1])
  })
  const mock = await mockStressTimeline(page, {
    sessionStatus: { [fixture.childID]: { type: "running" } },
    onMessages: (request) => messages.push(request.sessionID),
    onPrompt: (input) => prompts.push(input),
  })
  await installStressSessionTabs(page, { sessionIDs: [] })
  await page.goto("/")
  await page.getByRole("button", { name: "Agents", exact: true }).click()
  const dialog = page.getByRole("region", { name: "Agents", exact: true })
  await expect(dialog.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible()
  const child = dialog.getByRole("button", { name: new RegExp(fixture.expected.childTitle) }).first()
  await expect(dialog.getByRole("button", { name: "Interrupt", exact: true })).toBeVisible()
  expect(messages).toEqual([])
  await dialog.getByRole("button", { name: "Interrupt", exact: true }).click()
  await expect.poll(() => interrupts).toContain(fixture.childID)
  const working = dialog.getByRole("button", { name: "Interrupt", exact: true }).locator("..").locator("..")
  await working.getByRole("button", { name: "Send instruction", exact: true }).click()
  await working.getByRole("textbox", { name: "What should this agent do next?" }).fill("Inspect the failing check")
  await mock.push([status("idle", 1, fixture.childID)])
  await expect(dialog.getByRole("button", { name: "Interrupt", exact: true })).toHaveCount(0)
  await expect(dialog.getByRole("textbox", { name: "What should this agent do next?" })).toHaveValue(
    "Inspect the failing check",
  )
  await dialog.getByRole("button", { name: "Send", exact: true }).click()
  await expect.poll(() => prompts.length).toBe(1)
  expect(prompts[0]).toMatchObject({
    sessionID: fixture.childID,
    body: { text: "Inspect the failing check", delivery: "steer" },
  })
  await child.click()
  await expect(page).toHaveURL(new RegExp(sessionHref(fixture.childID)))
})

test("filters the fleet without the removed RedSkills integration", async ({ page }) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  await page.goto("/")
  await page.keyboard.press("Control+Shift+A")
  const dialog = page.getByRole("region", { name: "Agents", exact: true })
  await dialog.getByRole("textbox", { name: "Filter agents, projects or worktrees" }).fill("does-not-exist")
  await expect(dialog.getByText("No sessions match this view.")).toBeVisible()
  const menu = page.getByRole("navigation", { name: "Agents", exact: true })
  await expect(menu.getByRole("button", { name: "Workers", exact: true })).toHaveCount(0)
  await expect(menu.getByRole("button", { name: "Remote workers", exact: true })).toBeVisible()
  await dialog.getByRole("textbox", { name: "Filter agents, projects or worktrees" }).fill("")
  await expect(dialog.getByText("No sessions match this view.")).toHaveCount(0)
  for (const width of [1440, 720, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(dialog.getByRole("button", { name: "Needs attention" })).toBeVisible()
    expect(
      (await dialog.getByRole("textbox", { name: "Filter agents, projects or worktrees" }).boundingBox())?.width,
    ).toBeGreaterThan(150)
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`agents-${width}.png`), animations: "disabled" })
  }
})

test("starts native Redcode sessions when external CLI adapters are unavailable", async ({ page }) => {
  const creates: unknown[] = []
  await mockStressTimeline(page, {
    onSessionCreate: (body) => {
      creates.push(body)
    },
  })
  await installStressSessionTabs(page, { sessionIDs: [] })
  await page.route("**/api/harness", (route) =>
    route.fulfill({ status: 403, json: { message: "External adapters denied" } }),
  )
  await page.goto("/agents?view=harness")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  await expect(workspace.getByRole("button", { name: /, Coding agent$/ })).toContainText("Redcode")
  await workspace.getByLabel("Checkout directory on this host", { exact: true }).fill(fixture.directory)
  await workspace.getByRole("button", { name: "Start Redcode session", exact: true }).click()
  await expect(page).toHaveURL(/ses_mock_created/)
  expect(creates).toEqual([{ location: { directory: fixture.directory } }])
})

test("reviews local checkout enablement and registers a native slot without credentials", async ({ page }) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  const tree = await mockWorktreeOperations(page)
  const slots = await mockLocalSlots(page)
  await page.goto(`/agents?view=worktrees&project=${fixture.project.id}`)
  await page.getByLabel("Worktree name", { exact: true }).fill("local-slot")
  await page.getByRole("button", { name: "Create worktree", exact: true }).click()
  const checkout = page.getByRole("article", { name: tree.directory, exact: true })
  await checkout.getByRole("button", { name: "Enable this checkout for batches", exact: true }).click()
  const review = page.getByRole("region", { name: "Enable native batch execution", exact: true })
  await expect(review.getByText("One native execution slot on this server", { exact: true })).toBeVisible()
  expect(slots.registrations).toHaveLength(0)
  await review.getByRole("button", { name: "Enable this checkout for batches", exact: true }).click()
  await expect(
    checkout.getByRole("button", { name: "Checkout enabled for native batches", exact: true }),
  ).toBeDisabled()
  expect(slots.registrations).toEqual([
    { kind: "local", id: expect.stringMatching(/^local-/), directories: [tree.directory], tags: [] },
  ])
  await page.goto("/agents?view=hosts")
  const hosts = page.getByRole("list", { name: "Available hosts", exact: true })
  await expect(hosts.getByRole("button", { name: /reference-worker/ })).toBeVisible()
  await expect(hosts.getByRole("button")).toHaveCount(2)
  await expect(hosts.getByRole("button", { name: /Coordinator host/ })).toBeVisible()
})

test("shows native daily usage with linked charts, explicit coverage and project filters", async ({ page }) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  const usage = await mockNativeUsage(page)
  await page.goto("/agents?view=usage")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  await expect(workspace.getByText("Recorded cost: $1.25. Tokens: 120.", { exact: true })).toBeVisible()
  await expect(
    workspace.getByText("Accounting records: 1 reported, 1 estimated, 1 unknown, 0 legacy.", { exact: true }),
  ).toBeVisible()
  await expect(workspace.getByRole("table", { name: "Daily native usage" }).getByRole("row")).toHaveCount(3)
  const cost = workspace.getByRole("slider", { name: "Explore Cost (USD)", exact: true })
  const tokens = workspace.getByRole("slider", { name: "Explore Tokens", exact: true })
  await expect(cost.locator("svg")).toBeVisible()
  await cost.focus()
  await cost.press("Home")
  await expect(tokens).toHaveAttribute("aria-valuenow", "0")
  await cost.press("End")
  await expect(tokens).toHaveAttribute("aria-valuenow", "1")
  await workspace.getByLabel("Period", { exact: true }).selectOption("30")
  await workspace.getByLabel("Project", { exact: true }).selectOption(fixture.project.id)
  await expect.poll(() => usage.requests.at(-1)?.searchParams.get("project")).toBe(fixture.project.id)
  expect(usage.requests.at(-1)?.searchParams.get("series")).toBe("daily")
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.emulateMedia({ colorScheme: viewport.width < 500 ? "dark" : "light", reducedMotion: "reduce" })
    await page.setViewportSize(viewport)
    await expect(workspace.getByRole("table", { name: "Daily native usage" })).toBeVisible()
    await expect.poll(() => workspace.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0)
    await page.screenshot({
      path: test.info().outputPath(`native-usage-${viewport.width}.png`),
      animations: "disabled",
    })
  }
})
