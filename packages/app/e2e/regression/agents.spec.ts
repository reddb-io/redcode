import { expect, test } from "@playwright/test"
import { fixture, installStressSessionTabs, mockStressTimeline } from "../utils/session-fixture"
import { sessionHref } from "../utils/app"
import { status } from "../utils/timeline"
import { mockRemoteWorkers, mockWaitingWorker } from "../utils/worker-fixture"

test.use({ viewport: { width: 1440, height: 900 } })

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

test("filters the fleet and keeps optional workers separate from sessions", async ({ page }) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  await page.goto("/")
  await page.keyboard.press("Control+Shift+A")
  const dialog = page.getByRole("region", { name: "Agents", exact: true })
  await dialog.getByRole("textbox", { name: "Filter agents, projects or worktrees" }).fill("does-not-exist")
  await expect(dialog.getByText("No sessions match this view.")).toBeVisible()
  await page
    .getByRole("navigation", { name: "Agents", exact: true })
    .getByRole("button", { name: "Workers", exact: true })
    .click()
  await expect(dialog.getByText("Workers are unavailable. Sessions work independently of redskilled.")).toBeVisible()
  await page
    .getByRole("navigation", { name: "Agents", exact: true })
    .getByRole("button", { name: "Sessions", exact: true })
    .click()
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

test("steers workers and confirms disruptive project controls", async ({ page }) => {
  const controls: object[] = []
  await mockStressTimeline(page, {
    redskilled: {
      lifecycle: "live",
      consent: "accepted",
      scope: "project",
      native: true,
      payload: {
        version: 1,
        generated_at: "2026-10-10T00:00:00Z",
        staleness: {
          sampled_at: null,
          age_ms: null,
          stale: false,
          measured_worker_count: 1,
          unmeasured_workers: [],
          reason: "",
        },
        host: {
          worker_count: 1,
          project_count: 1,
          measured_worker_count: 1,
          ceiling_used_fraction: null,
          ceiling: { memory_bytes: null, worker_count: null },
        },
        workers: [
          {
            worker_id: "worker_review",
            project_label: "reddb-io/redcode",
            pid: 1234,
            started_at: "2026-10-10T00:00:00Z",
            uptime_ms: 1000,
            vitals: { rss_bytes: null, sampled_at: null, age_ms: null, fresh: true },
            budget: { declared: null, bytes: null, used_bytes: null, used_fraction: null, enforceable: false },
            log: { last_line: "Reviewing changes", published_at: null },
          },
        ],
      },
    },
    onWorkerControl: (input) => controls.push(input),
  })
  await installStressSessionTabs(page, { sessionIDs: [] })
  await page.goto("/")
  await page.getByRole("button", { name: "Agents", exact: true }).click()
  const dialog = page.getByRole("region", { name: "Agents", exact: true })
  await page
    .getByRole("navigation", { name: "Agents", exact: true })
    .getByRole("button", { name: "Workers", exact: true })
    .click()
  await expect(dialog.getByText("worker_review", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Send instruction" }).click()
  await dialog.getByRole("textbox", { name: "What should this agent do next?" }).fill("Focus on the Windows build")
  await dialog.getByRole("button", { name: "Send", exact: true }).click()
  await expect
    .poll(() => controls)
    .toContainEqual({
      action: "steer",
      directory: fixture.directory,
      body: { worker: "worker_review", text: "Focus on the Windows build" },
    })
  await dialog.getByRole("button", { name: "Stop project workers" }).click()
  expect(controls).toHaveLength(1)
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click()
  await expect.poll(() => controls).toContainEqual({ action: "stopProject", directory: fixture.directory })
})
