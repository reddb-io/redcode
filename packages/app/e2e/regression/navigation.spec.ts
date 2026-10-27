import { expect, test } from "@playwright/test"
import { seed, sessionHref } from "../utils/app"
import { fixture, mockStressTimeline } from "../utils/session-fixture"
import { mockWorkspace } from "../utils/workspace"

// Owns the desktop navigation's rendered state and actions; the model suite owns tree ordering.
test("navigation shares location reads and keeps repository, branch and worktree per session", async ({ page }) => {
  const main = "C:/Work/redcode"
  const checkout = "C:/Work/redcode-worktrees/voice"
  const nested = `${checkout}/packages/app`
  const detached = "C:/Work/redcode-worktrees/review"
  const plain = "C:/Windows/System32"
  const reads: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.pathname === "/api/vcs") reads.push(url.searchParams.get("location[directory]") ?? main)
  })
  const workspace = await mockWorkspace(page, {
    name: "Redcode",
    directory: main,
    project: { sandboxes: [checkout] },
    sessions: [
      { id: "ses_git_main", title: "Main checkout", directory: main },
      { id: "ses_git_voice", title: "Voice checkout", directory: nested },
      { id: "ses_git_shared", title: "Same checkout", directory: nested },
      { id: "ses_git_detached", title: "Review checkout", directory: detached },
      { id: "ses_no_git", title: "Local folder", directory: plain, projectID: "global" },
    ],
    seed: { tabs: [], theme: { id: "opencode", scheme: "dark" } },
    vcsInfo: (directory) =>
      directory === plain
        ? { branch: {} }
        : {
            provider: "git",
            repository: { name: "reddb-io/redcode", directory: main },
            branch: { current: directory === detached ? undefined : directory === main ? "main" : "voice-input" },
            worktree: {
              directory: directory === main ? main : directory === detached ? detached : checkout,
              main: directory === main,
            },
          },
  })
  await page.goto("/")
  const rail = page.getByRole("navigation", { name: "Navigation", exact: true })
  const toggle = rail.getByRole("button", { name: "Toggle sidebar", exact: true })
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  const sidebar = page.getByRole("complementary", { name: "Projects and sessions", exact: true })
  const mainRow = sidebar.locator('[data-action="navigation-session"][data-session="ses_git_main"]')
  const voice = sidebar.locator('[data-action="navigation-session"][data-session="ses_git_voice"]')
  const local = sidebar.locator('[data-action="navigation-session"][data-session="ses_no_git"]')
  const review = sidebar.locator('[data-action="navigation-session"][data-session="ses_git_detached"]')
  await expect(mainRow.getByText("reddb-io/redcode", { exact: true })).toBeVisible()
  await expect(mainRow.getByText("main", { exact: true })).toBeVisible()
  await expect(mainRow.getByText("Main", { exact: true })).toBeVisible()
  await expect(voice.getByText("voice-input", { exact: true })).toBeVisible()
  await expect(voice.getByText("voice", { exact: true })).toBeVisible()
  await expect(voice.getByText(nested, { exact: true })).toBeVisible()
  await expect(voice).toHaveAttribute(
    "title",
    `Repository: reddb-io/redcode\nBranch: voice-input\nWorktree: ${checkout}\nDirectory: ${nested}`,
  )
  await expect(local).toContainText(plain)
  await expect(local).not.toContainText("reddb-io/redcode")
  await expect(local).not.toContainText("main")
  await expect(review.getByText("Detached HEAD", { exact: true })).toBeVisible()
  await expect(review.getByText("review", { exact: true })).toBeVisible()
  expect(reads.filter((directory) => directory === nested)).toHaveLength(1)
  workspace.push([
    {
      id: "evt_navigation_branch",
      created: Date.now(),
      type: "vcs.branch.updated",
      location: { directory: nested },
      data: { branch: "voice-refined" },
    },
  ])
  await expect(voice.getByText("voice-refined", { exact: true })).toBeVisible()
  await expect(voice.getByText("reddb-io/redcode", { exact: true })).toBeVisible()
  await expect(voice.getByText("voice", { exact: true })).toBeVisible()
  await expect(mainRow.getByText("main", { exact: true })).toBeVisible()
  await sidebar.screenshot({ path: "../../tmp/navigation-git-context.png" })
})

test("navigation shares pins, filtering, keyboard focus and persisted panel width", async ({ page }) => {
  await mockStressTimeline(page)
  await seed(page, {
    projects: { local: [{ worktree: fixture.directory, expanded: true }] },
    lastProject: { local: fixture.directory },
    tabs: [fixture.sourceID],
  })
  await page.goto(sessionHref(fixture.sourceID))
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  const rail = page.getByRole("navigation", { name: "Navigation", exact: true })
  const home = rail.getByRole("button", { name: "Home", exact: true })
  await expect(home).toBeVisible()
  await expect(rail.locator('[data-rail-item][tabindex="0"]')).toHaveCount(1)
  await home.focus()
  await home.press("ArrowDown")
  await expect(rail.getByRole("button", { name: "New session", exact: true })).toBeFocused()
  await page.keyboard.press("End")
  await expect(rail.getByRole("button", { name: "Server", exact: true })).toBeFocused()
  await page.keyboard.press("Home")
  await expect(home).toBeFocused()

  const toggle = rail.getByRole("button", { name: "Toggle sidebar", exact: true })
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  const sidebar = page.getByRole("complementary", { name: "Projects and sessions", exact: true })
  await expect(sidebar.getByRole("button", { name: "By attention", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await sidebar.getByRole("button", { name: "By project", exact: true }).click()
  const target = sidebar.locator(
    `[data-section="projects"] [data-action="navigation-session"][data-session="${fixture.targetID}"]`,
  )
  await expect(target).toBeVisible()
  await target.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click()
  const pinned = sidebar.locator('[data-section="pinned"]')
  await expect(pinned.locator(`[data-session="${fixture.targetID}"]`)).toBeVisible()
  await pinned.getByRole("button", { name: "Pinned", exact: true }).click()
  await expect(pinned.locator(`[data-session="${fixture.targetID}"]`)).toBeHidden()
  const filter = sidebar.getByRole("searchbox")
  await filter.fill(fixture.expected.targetTitle)
  await expect(pinned.locator(`[data-session="${fixture.targetID}"]`)).toBeVisible()
  await expect(sidebar.locator(`[data-session="${fixture.sourceID}"]`)).toHaveCount(0)
  await filter.press("Escape")
  await expect(filter).toHaveValue("")
  await expect(filter).toBeFocused()
  await expect(pinned.locator(`[data-session="${fixture.targetID}"]`)).toBeHidden()
  await pinned.getByRole("button", { name: "Pinned", exact: true }).click()
  await pinned.locator(`[data-session="${fixture.targetID}"]`).click()
  await expect(page).toHaveURL(sessionHref(fixture.targetID))
  await expect(pinned.locator(`[data-session="${fixture.targetID}"]`)).toHaveAttribute("aria-current", "page")

  const resize = sidebar.getByRole("separator")
  await resize.focus()
  await resize.press("End")
  await expect(resize).toHaveAttribute("aria-valuenow", "420")
  await page.reload()
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  await expect(sidebar.getByRole("separator")).toHaveAttribute("aria-valuenow", "420")
  await expect(sidebar.getByRole("button", { name: "By project", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(pinned.locator(`[data-session="${fixture.targetID}"]`)).toBeVisible()
  const box = await sidebar.getByRole("separator").boundingBox()
  if (!box) throw new Error("Missing panel resize handle")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 300, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(sidebar).toHaveAttribute("inert", "")
})
