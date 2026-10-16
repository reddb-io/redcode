import { expect, test } from "@playwright/test"
import type { Worker } from "@opencode/schema/worker"
import { WorkerLease } from "@opencode/schema/worker-lease"
import { Schema } from "effect"
import { fixture, installStressSessionTabs, mockStressTimeline } from "../utils/session-fixture"
import { sessionHref } from "../utils/app"
import { status } from "../utils/timeline"
import { mockRemoteWorkers, mockWaitingWorker } from "../utils/worker-fixture"
import {
  mockHarnessOperations,
  mockWorktreeOperations,
  mockMachineInspection,
  mockWorkerEnvironments,
} from "../utils/agent-operation-fixture"
import { SERVER, REMOTE_SERVER } from "../utils/app"

test.use({ viewport: { width: 1440, height: 900 } })

// LAN HTTP pages expose getRandomValues but not the secure-context randomUUID API.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined })
  })
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
  await workspace.getByLabel("Coding agent", { exact: true }).selectOption("claude")
  await workspace.getByLabel("Checkout directory on this host", { exact: true }).fill(fixture.directory)
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
  harness.loseProcess()
  await expect(
    workspace.getByRole("checkbox", { name: "I confirmed that the original process is stopped" }),
  ).toBeVisible()
  await expect(workspace.getByRole("button", { name: "Resume native session", exact: true })).toBeDisabled()
  await expect(workspace.getByRole("button", { name: "Record reconciliation", exact: true })).toBeDisabled()
  await workspace.getByRole("checkbox", { name: "I confirmed that the original process is stopped" }).check()
  await workspace.getByRole("button", { name: "Record reconciliation", exact: true }).click()
  await expect(workspace.getByRole("button", { name: "Resume native session", exact: true })).toBeEnabled()
})

test("creates and reviews a worktree, targets its harness and archives a detached result", async ({ page }) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  const tree = await mockWorktreeOperations(page)
  await mockHarnessOperations(page)
  await page.goto(`/agents?view=worktrees&project=${fixture.project.id}`)
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  await workspace.getByLabel("Worktree name", { exact: true }).fill("agent-result")
  await workspace.getByRole("button", { name: "Create worktree", exact: true }).click()
  const child = workspace.getByRole("article", { name: tree.directory, exact: true })
  await child.getByRole("button", { name: "Review changes", exact: true }).click()
  await expect(workspace.getByLabel("Worktree diff", { exact: true })).toContainText("agent result")
  const integrated = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/worktree/integrate")
  await workspace.getByRole("button", { name: "Integrate reviewed commit", exact: true }).click()
  expect((await integrated).request().postDataJSON()).toEqual({
    projectID: fixture.project.id,
    directory: tree.directory,
    target: fixture.directory,
    head: "a".repeat(40),
    targetHead: "b".repeat(40),
  })
  await workspace.getByRole("button", { name: "Archive worktree", exact: true }).click()
  await workspace.getByRole("button", { name: "Confirm archive", exact: true }).click()
  await expect(child).toHaveCount(0)
  await expect(workspace.getByRole("button", { name: "Restore as a new worktree", exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("worktree-cycle.png"), animations: "disabled" })
  await workspace.getByRole("button", { name: "Restore as a new worktree", exact: true }).click()
  await child.getByRole("button", { name: "Start coding agent here", exact: true }).click()
  await expect(workspace.getByLabel("Checkout directory on this host", { exact: true })).toHaveValue(tree.directory)
})

test("machine onboarding checks the selected host and blocks an unusable worker route", async ({ page }) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  await mockMachineInspection(page)
  await page.goto("/agents?view=machines")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  const picker = workspace.getByLabel("Connected machine", { exact: true })
  const value = await picker.getByRole("option").nth(1).getAttribute("value")
  expect(value).toBeTruthy()
  await picker.selectOption(value!)
  await workspace.getByRole("button", { name: "Check server", exact: true }).click()
  await expect(workspace.getByText("Server version:", { exact: false })).toBeVisible()
  await workspace.getByRole("button", { name: "Use this project as a worker", exact: true }).click()
  await workspace.getByLabel("Worker name", { exact: true }).fill("pi-a")
  await workspace.getByLabel("Existing checkout directory on the machine", { exact: true }).fill("/home/pi/project")
  await expect(workspace.getByRole("button", { name: "Register worker checkout", exact: true })).toBeDisabled()
  await expect(workspace.getByText("The coordinator needs a reachable worker address", { exact: false })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("machine-onboarding.png"), animations: "disabled" })
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
  await expect(workspace.getByText("Server version: fixture", { exact: true })).toBeVisible()
  await workspace.getByRole("button", { name: "Use this project as a worker", exact: true }).click()
  await expect(workspace.getByLabel("Worker name", { exact: true })).toHaveValue("strong-pc")
  const strongKey = await workspace.getByLabel("Connected machine", { exact: true }).inputValue()
  await workspace.getByLabel("Worker name", { exact: true }).fill("pi-a")
  await workspace.getByLabel("Capabilities (comma-separated)", { exact: true }).fill("linux, arm64")
  await workspace.getByLabel("Project on the machine", { exact: true }).selectOption(fixture.directory)
  await expect(workspace.getByLabel("Existing checkout directory on the machine", { exact: true })).toHaveValue(
    fixture.directory,
  )
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
    page.getByRole("complementary", { name: "Agents", exact: true }).getByLabel("Host", { exact: true }),
  ).toHaveValue(/^ssh:/)
  await page
    .getByRole("complementary", { name: "Agents", exact: true })
    .getByRole("button", { name: "Machines", exact: true })
    .click()
  await workspace.getByLabel("Connected machine", { exact: true }).selectOption("ssh:box")
  await workspace.getByRole("button", { name: "Use this project as a worker", exact: true }).click()
  await expect(workspace.getByText("Server version: fixture", { exact: true })).toBeVisible()
  await workspace.getByLabel("Project on the machine", { exact: true }).selectOption(fixture.directory)
  await expect(workspace.getByRole("button", { name: "Register worker checkout", exact: true })).toBeDisabled()
  await expect(
    workspace.getByText(/A desktop loopback forward cannot be registered with a remote coordinator/),
  ).toBeVisible()
  await workspace.getByLabel("Connected machine", { exact: true }).selectOption(strongKey)
  await workspace.getByLabel("Project on the machine", { exact: true }).selectOption(fixture.directory)
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
  await expect(workspace.getByText("Waiting for enough unreserved free RAM.", { exact: true })).toBeVisible()
  await expect(workspace.getByText("CPU: 2 · RAM: 1.50 GiB", { exact: true })).toBeVisible()
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
  await task.getByRole("button", { name: "Send instruction", exact: true }).click()
  const editor = task.getByLabel("What should this agent do next?", { exact: true })
  await editor.fill("Run the ARM64 checks")
  const refreshed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/workers" && response.request().method() === "GET",
  )
  await refreshed
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue("Run the ARM64 checks")
  await task.getByLabel("Delivery", { exact: true }).selectOption("queue")
  const queued = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/batch-waiting/control"))
  await task.getByRole("button", { name: "Send", exact: true }).click()
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
  await task.getByRole("button", { name: "Interrupt", exact: true }).click()
  expect((await interrupted).request().postDataJSON()).toEqual({ kind: "interrupt", task: "task-review" })
  await expect(task.getByText("Interrupted · pi-a", { exact: true })).toBeVisible()
  await expect(task.getByRole("button", { name: "Interrupt", exact: true })).toHaveCount(0)
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
  await workspace.getByRole("button", { name: /Inspect child navigation · Worker question/ }).click()
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

test("shows unknown initial CPU usage and hides stale resources after a failed refresh", async ({ page }) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  await mockRemoteWorkers(page)
  await page.goto("/agents?view=hosts")
  const workspace = page.getByRole("region", { name: "Agents", exact: true })
  const host = workspace.getByRole("article", { name: "Coordinator host", exact: true })
  await expect(host.getByText("Collecting CPU sample", { exact: true })).toBeVisible()
  await expect(host.getByText("6.00 GiB / 8.00 GiB", { exact: true })).toBeVisible()
  const failed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/resources" && response.status() === 503,
  )
  await page.route("**/api/resources", (route) => route.fulfill({ status: 503, json: { message: "Offline" } }))
  await failed
  await expect(host.getByText("Host resources are unavailable. Previous measurements are not live.")).toBeVisible()
  await expect(host.getByText("6.00 GiB / 8.00 GiB", { exact: true })).toHaveCount(0)
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
  const task = workspace
    .getByRole("article")
    .filter({ has: page.getByText("Check the original admission", { exact: true }) })
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
  await expect(dialog.getByText("Connect a machine to start sending tasks.")).toBeVisible()
  await dialog.getByRole("button", { name: "Add worker", exact: true }).click()
  await dialog.getByLabel("Worker name", { exact: true }).fill("pi-a")
  await dialog.getByLabel("Server address", { exact: true }).fill("http://192.168.1.50:4096")
  await dialog.getByLabel("Project directory on the worker", { exact: true }).fill("/home/pi/project")
  await dialog.getByLabel("Server password or pairing token", { exact: true }).fill("fixture-secret")
  await dialog.getByLabel("Capabilities, separated by commas", { exact: true }).fill("linux, arm64")
  await dialog.getByRole("button", { name: "Connect worker", exact: true }).click()
  await expect(dialog.getByRole("heading", { name: "pi-a · Connected", exact: true })).toBeVisible()
  await expect(dialog.getByLabel("Server password or pairing token", { exact: true })).toHaveCount(0)
  await dialog.getByLabel("What should the worker do?", { exact: true }).fill("Review Linux compatibility")
  await dialog.getByLabel("Run on", { exact: true }).selectOption("pi-a")
  await dialog.getByRole("button", { name: "Add to batch", exact: true }).click()
  await dialog.getByLabel("What should the worker do?", { exact: true }).fill("Run the test suite")
  await dialog.getByRole("button", { name: "Send batch", exact: true }).click()
  await expect(dialog.getByText("Completed · pi-a", { exact: true })).toHaveCount(2)
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
  await task.getByRole("button", { name: "Review changes", exact: true }).click()
  await expect(dialog.getByRole("heading", { name: "Collected changes", exact: true })).toBeVisible()
  await dialog.getByText("result.txt (+1 / −0)", { exact: true }).click()
  await expect(dialog.getByText(workers.patch, { exact: true })).toBeVisible()
  const download = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Download patch", exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/^task-[a-z0-9-]+\.patch$/)
  await page.screenshot({ path: test.info().outputPath("remote-workers.png"), animations: "disabled" })
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
