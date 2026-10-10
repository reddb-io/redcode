import { expect, test } from "@playwright/test"
import { fixture, installStressSessionTabs, mockStressTimeline } from "../utils/session-fixture"
import { sessionHref } from "../utils/app"
import { status } from "../utils/timeline"
import { mockRemoteWorkers } from "../utils/worker-fixture"

test.use({ viewport: { width: 1440, height: 900 } })

test("registers remote workers, sends an independent task batch and downloads reviewed changes", async ({ page }) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  const workers = await mockRemoteWorkers(page)
  await page.goto("/")
  await page.getByRole("button", { name: "Agents", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Remote workers", exact: true }).click()
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
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "Agents", exact: true })).toBeVisible()
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
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("textbox", { name: "Filter agents, projects or worktrees" }).fill("does-not-exist")
  await expect(dialog.getByText("No sessions match this view.")).toBeVisible()
  await dialog.getByRole("button", { name: "Workers", exact: true }).click()
  await expect(dialog.getByText("Workers are unavailable. Sessions work independently of redskilled.")).toBeVisible()
  await dialog.getByRole("button", { name: "Sessions", exact: true }).click()
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
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Workers", exact: true }).click()
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
