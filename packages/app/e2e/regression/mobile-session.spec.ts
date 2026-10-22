import { expect, test, type Locator, type Page } from "@playwright/test"
import { seed, sessionHref, type SeedInput } from "../utils/app"
import { fixture, mockStressTimeline } from "../utils/session-fixture"
import { fileNode } from "../utils/workspace"

// The source and target sessions; the child session is not a home row.
const rows = 2

test("mobile navigation leaves the conversation full width and keeps scopes accessible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockStressTimeline(page)
  await openStress(page)
  await page.goto(sessionHref(fixture.targetID))
  const rail = page.getByRole("navigation", { name: "Navigation", exact: true })
  const main = page.getByRole("main")
  const dock = page.getByRole("navigation", { name: "Mobile navigation", exact: true })
  const menu = dock.getByRole("button", { name: "More", exact: true })
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("data-density", "tiny")
  await expect(page.locator('[data-component="markdown"]').first()).toHaveCSS("font-size", "13px")
  await page.setViewportSize({ width: 1024, height: 900 })
  await expect(page.locator('[data-component="markdown"]').first()).toHaveCSS("font-size", "14px")
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(rail).toBeHidden()
    await expect(dock).toBeVisible()
    await expect(dock.getByRole("button")).toHaveCount(5)
    await expect.poll(async () => (await main.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(width - 2)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true })
  await prompt.fill("Keep the mobile draft")
  for (const height of [480, 844]) {
    await page.setViewportSize({ width: 390, height })
    await expect
      .poll(async () => {
        const editor = await prompt.boundingBox()
        const bar = await dock.boundingBox()
        return !!editor && !!bar && editor.y + editor.height <= bar.y && bar.y + bar.height <= height
      })
      .toBe(true)
    await expect(prompt).toHaveText("Keep the mobile draft")
  }
  await page.screenshot({ path: test.info().outputPath("mobile-full-width-session.png"), animations: "disabled" })
  const search = dock.getByRole("button", { name: "Search", exact: true })
  await search.click()
  await expect(page.getByPlaceholder("Search files, commands, and sessions", { exact: true })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(search).toBeFocused()
  await menu.click()
  for (const name of ["New session", "Settings", "Servers", "Help"])
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible()
  await expect(page.getByRole("menuitem")).toHaveCount(4)
  await page.keyboard.press("Escape")
  await expect(menu).toBeFocused()
  await dock.getByRole("button", { name: "Browse", exact: true }).click()
  const sidebar = page.getByRole("complementary", { name: "Projects and sessions", exact: true })
  await expect(sidebar).toBeVisible()
  await sidebar.getByRole("button", { name: "Close sidebar", exact: true }).click()
  await expect(sidebar).toBeHidden()
  await expect(dock.getByRole("button", { name: "Browse", exact: true })).toBeFocused()
  await dock.getByRole("button", { name: "Agents", exact: true }).click()
  await expect(page.getByRole("region", { name: "Agents", exact: true })).toBeVisible()
  await dock.getByRole("button", { name: "Browse", exact: true }).click()
  const agents = page.getByRole("complementary", { name: "Agents", exact: true })
  await expect(agents.getByRole("button", { name: "Machines", exact: true })).toBeVisible()
  await expect(agents).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(agents).toBeHidden()
  await expect(dock.getByRole("button", { name: "Browse", exact: true })).toBeFocused()
  await page.setViewportSize({ width: 1024, height: 900 })
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact")
  await expect(rail).toBeVisible()
  await expect(dock).toBeHidden()
  await expect(menu).toBeHidden()
})

test.describe("mobile touch density", () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } })

  test("denser reading preserves touch targets and editable text", async ({ page }) => {
    await mockStressTimeline(page)
    await openStress(page)
    await page.goto(sessionHref(fixture.targetID))
    const composer = page.getByRole("textbox", { name: "Prompt", exact: true })
    await expect(page.locator("[data-timeline-virtual-content]")).toBeVisible()
    await expect(
      page.locator(`[data-timeline-row="UserMessage"][data-message-id="${fixture.expected.targetMessageIDs.at(-1)}"]`),
    ).toBeInViewport()
    await expect(composer).toHaveCSS("font-size", "16px")
    await expect(page.locator('[data-component="markdown"]').first()).toHaveCSS("font-size", "13px")
    const menu = page
      .getByRole("navigation", { name: "Mobile navigation", exact: true })
      .getByRole("button", { name: "More", exact: true })
    await expect.poll(async () => (await menu.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
    await expect.poll(async () => (await menu.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(44)
    await page.screenshot({ path: test.info().outputPath("android-dense-session.png"), animations: "disabled" })
    await menu.click()
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
    await expect(page.getByText("Install Redcode", { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath("android-installation-settings.png"), animations: "disabled" })
  })
})

async function openStress(page: Page, extra: SeedInput = {}) {
  await seed(page, {
    projects: { local: [{ worktree: fixture.directory, expanded: true }] },
    tabs: [fixture.sourceID, fixture.targetID],
    ...extra,
  })
}

for (const position of ["top", "bottom"] as const) {
  test(`mobile session tabs switch views and keep the terminal cached with ${position} navigation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockStressTimeline(page, { fileList: () => [], pty: {} })
    await openStress(page, {
      lastProject: { local: fixture.directory },
      settings: { general: { mobileTitlebarPosition: position } },
    })
    await page.goto(sessionHref(fixture.targetID))

    const tabs = page.getByRole("tablist", { name: "Session view", exact: true })
    const navigation = page.locator('[data-slot="session-mobile-view-navigation"]')
    const more = tabs.getByRole("tab", { name: "More...", exact: true })
    const views = page.getByRole("dialog", { name: "More options", exact: true })
    const picker = tabs.getByRole("tab", { selected: true })

    const message = page.locator(
      `[data-timeline-row="UserMessage"][data-message-id="${fixture.expected.targetMessageIDs.at(-1)}"]`,
    )

    const composer = page.getByRole("textbox", { name: "Prompt", exact: true })
    await expect(picker).toHaveText("Session")
    await expect(navigation).toHaveCount(1)
    await expect(message).toBeVisible()
    await expect(composer).toBeVisible()
    await expect(tabs.getByRole("tab")).toHaveText(["Session", "Changes", "More..."])
    await expect(tabs).toHaveCSS("padding-left", "0px")
    await expect(tabs).toHaveCSS("padding-right", "0px")

    if (position === "top") {
      const titlebar = page.locator('[data-slot="titlebar-v2"]')
      await expect(titlebar).toHaveCSS("padding-top", "8px")
      await expect(titlebar).toHaveCSS("height", "36px")
    }

    await expect
      .poll(async () => {
        const bounds = await navigation.boundingBox()

        return !!bounds && bounds.x >= 1 && bounds.x <= 2 && bounds.width >= 386 && bounds.width <= 388
      })
      .toBe(true)
    await expect
      .poll(async () => {
        const bar = await tabs.boundingBox()
        const input = await composer.boundingBox()
        const dock = await page.locator('[data-component="session-composer-dock"]').boundingBox()
        const panel = await page.locator('[data-slot="session-chat-panel"]').boundingBox()

        if (!bar || !input || !dock || !panel) return false

        if (position === "bottom")
          return bar.y >= dock.y + dock.height && Math.abs(bar.y + bar.height - panel.y - panel.height) <= 1

        return Math.abs(bar.y - panel.y) <= 1 && bar.y + bar.height <= input.y
      })
      .toBe(true)
    await expect(page.locator("[data-session-title]")).toHaveCount(0)
    await expect(page.locator('[data-slot="mobile-tabs-trigger"]')).toContainText(fixture.expected.targetTitle)
    await page.getByRole("button", { name: "Tabs", exact: true }).click()
    const drawer = page.getByRole("dialog", { name: "Tabs", exact: true })
    await expect(drawer).toHaveAttribute("data-open", "")
    await expect(drawer).not.toHaveAttribute("data-transitioning")
    await navigateFromMenu(page, "Settings")
    await expect(page.getByTestId("settings-screen")).toBeVisible()
    await page.getByRole("button", { name: "Back to app", exact: true }).click()
    await page.getByRole("button", { name: "Tabs", exact: true }).click()
    await expect(drawer).not.toHaveAttribute("data-transitioning")
    await expect(drawer.getByRole("button", { name: "New session", exact: true })).toBeInViewport()
    await page.keyboard.press("Escape")
    await expect(drawer).toBeHidden()

    await more.click()
    await expect(views).toBeVisible()
    await expect(more).toHaveAttribute("aria-expanded", "true")

    for (const name of ["Files", "Terminal", "Usage", "Session details"])
      await expect(views.getByRole("button", { name, exact: true })).toBeVisible()
    await expect(views).not.toHaveAttribute("data-transitioning")
    await page.keyboard.press("Escape")
    await expect(views).toBeHidden()
    await expect(more).toHaveAttribute("aria-expanded", "false")
    await expect(more).toBeFocused()
    await expect(picker).toHaveText("Session")
    await more.press("Enter")
    await views.getByRole("button", { name: "Usage", exact: true }).click()
    await expect(views).toBeHidden()
    await expect(picker).toHaveText("More...")
    await expect(page.getByText("Total Cost", { exact: true })).toBeVisible()
    const usage = page.locator('[data-slot="session-usage-content"]')
    await expect(usage).toHaveCSS("padding-top", "16px")
    await expect(usage).toHaveCSS("padding-inline-start", "16px")
    await expect(usage).toHaveCSS("padding-inline-end", "16px")
    await expect(composer).toBeHidden()

    await more.click()
    await expect(views.getByRole("button", { name: "Usage", exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect(views.getByRole("button", { name: "Status", exact: true })).toHaveCount(0)
    await views.evaluate((element) => element.setAttribute("data-drawer-probe", "single"))
    await views.getByRole("button", { name: "Session details", exact: true }).click()
    const details = page.getByRole("dialog", { name: "Session details", exact: true })
    await expect(details).toHaveAttribute("data-drawer-probe", "single")
    await expect(page.getByRole("dialog")).toHaveCount(1)
    await expect(page.locator('[data-slot="mobile-drawer-overlay"]')).toHaveCount(1)
    await expect(details.locator('[data-slot="mobile-panel-header"]')).toHaveCount(0)
    await expect(details.getByRole("button", { name: "Close", exact: true })).toHaveCount(0)
    await expect(details.getByRole("heading", { name: "Session details", exact: true })).toHaveCSS("width", "1px")
    await expect(details.getByText(fixture.project.name, { exact: true })).toBeVisible()
    await expect(details.getByRole("button", { name: "No changes", exact: true })).toBeVisible()
    await expect(details.getByRole("button", { name: "MCP", exact: true })).toBeVisible()
    await page.locator('[data-slot="mobile-drawer-overlay"]').click({ position: { x: 10, y: 10 } })
    await expect(details).toBeHidden()
    await expect(more).toBeFocused()
    await more.click()
    await views.getByRole("button", { name: "Session details", exact: true }).click()
    await expect(details.getByRole("button", { name: "No changes", exact: true })).toBeVisible()
    await expect(details).not.toHaveAttribute("data-transitioning")
    await page.keyboard.press("Escape")
    await expect(details).toBeHidden()
    await expect(more).toBeFocused()
    await more.click()
    await views.getByRole("button", { name: "Session details", exact: true }).click()
    await details.getByRole("button", { name: "No changes", exact: true }).click()
    await expect(details).toBeHidden()
    await expect(picker).toHaveText("Changes")
    await expect(page.getByText("No uncommitted changes yet", { exact: true })).toBeVisible()
    await expect(page.locator('[data-slot="session-review-header"]')).toHaveCSS("height", "40px")
    await expect(page.locator('[data-slot="session-review-header"]')).toHaveCSS("padding-left", "8px")
    await expect(composer).toBeHidden()
    await more.click()
    await views.getByRole("button", { name: "Session details", exact: true }).click()
    await details.getByRole("button", { name: "No changes", exact: true }).click()
    await expect(details).toBeHidden()
    await expect(picker).toHaveText("Changes")
    await expect(page.getByText("No uncommitted changes yet", { exact: true })).toBeVisible()

    await more.click()
    await views.getByRole("button", { name: "Files", exact: true }).click()
    await expect(views).toBeHidden()
    await expect(picker).toHaveText("More...")
    await expect(page.getByRole("combobox", { name: "Filter files", exact: true })).toBeVisible()
    await expect(composer).toBeHidden()

    await more.click()
    await expect(views.getByRole("button", { name: "Files", exact: true })).toHaveAttribute("aria-pressed", "true")
    await views.getByRole("button", { name: "Terminal", exact: true }).click()
    await expect(views).toBeHidden()
    const panel = page.locator("#terminal-panel")
    await expect(panel).toHaveAttribute("data-opened", "true")
    await expect(panel.getByRole("tab", { name: /Terminal 1/ })).toBeVisible()
    await expect(panel.locator('[data-component="terminal"]')).toBeVisible()
    await expect(panel.locator("textarea")).toBeEditable()
    await expect(panel).toHaveCount(1)
    await panel.evaluate((element) => element.setAttribute("data-cache-probe", "original"))
    await expect(composer).toBeHidden()

    await tabs.getByRole("tab", { name: "Session", exact: true }).click()
    await expect(message).toBeVisible()
    await expect(panel).toBeHidden()
    await expect(panel).toHaveAttribute("inert", "")
    await expect(panel).toHaveAttribute("data-cache-probe", "original")

    await page.keyboard.press("Control+Backquote")
    await expect(picker).toHaveText("More...")
    await expect(panel).toBeVisible()
    await expect(panel).toHaveAttribute("data-cache-probe", "original")
    await page.keyboard.press("Control+Backquote")
    await expect(picker).toHaveText("Session")

    await page.keyboard.press("Control+Backquote")
    await expect(picker).toHaveText("More...")
    await panel.getByRole("button", { name: "Close terminal", exact: true }).click()
    await expect(picker).toHaveText("Session")
    await expect(panel).toBeHidden()

    // The view resets to Session whenever the routed session changes, including through Home.
    const trigger = page.locator('[data-slot="mobile-tabs-trigger"]')

    const openTabs = async () => {
      await trigger.click()
      await expect(drawer).not.toHaveAttribute("data-transitioning")
    }

    const openTab = async (title: string) => {
      await openTabs()
      await drawer.locator('[data-slot="tab-link"]').filter({ hasText: title }).click()
      await expect(drawer).toBeHidden()
      await expect(trigger).toContainText(title)
    }

    await more.click()
    await views.getByRole("button", { name: "Usage", exact: true }).click()
    await expect(page.getByText("Total Cost", { exact: true })).toBeVisible()
    await openTab(fixture.expected.sourceTitle)
    await expect(picker).toHaveText("Session")
    await more.click()
    await views.getByRole("button", { name: "Files", exact: true }).click()
    await expect(picker).toHaveText("More...")
    await openTab(fixture.expected.targetTitle)
    await expect(picker).toHaveText("Session")
    await openTab(fixture.expected.sourceTitle)
    await expect(picker).toHaveText("Session")
    await more.click()
    await views.getByRole("button", { name: "Files", exact: true }).click()
    await expect(picker).toHaveText("More...")
    await openTabs()
    await navigateFromMenu(page, "Home")
    await expect(page).toHaveURL("/")
    await expect(drawer).toBeHidden()
    await openTab(fixture.expected.sourceTitle)
    await expect(picker).toHaveText("Session")

    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(picker).toBeHidden()
    await expect(page.locator("[data-session-title]")).toBeVisible()
  })
}

test("the summary's changes row switches the view and keeps the side tabs", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await mockStressTimeline(page, {
    fileList: (path) => (path ? [] : [fileNode(fixture.directory, "README.md")]),
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    findFiles: ({ query }) => ("README.md".includes(query) ? [fileNode(fixture.directory, "README.md")] : []),
  })
  await openStress(page, { lastProject: { local: fixture.directory } })
  await page.goto(sessionHref(fixture.targetID))

  const panel = page.getByRole("complementary", { name: "Review and files", exact: true })
  const readme = panel.getByRole("tab", { name: "README.md", exact: true })
  await page.getByRole("button", { name: "Toggle review", exact: true }).click()
  await page.keyboard.press("ControlOrMeta+p")
  const filePicker = page.getByRole("dialog")
  await filePicker.getByRole("textbox").fill("README")
  await filePicker.getByRole("option", { name: "/ README.md", exact: true }).click()
  await expect(readme).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByRole("tab", { name: "Open file", exact: true })).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  const tabs = page.getByRole("tablist", { name: "Session view", exact: true })
  const details = page.getByRole("dialog", { name: "Session details", exact: true })
  const more = tabs.getByRole("tab", { name: "More...", exact: true })
  const views = page.getByRole("dialog", { name: "More options", exact: true })
  await more.click()
  await views.getByRole("button", { name: "Session details", exact: true }).click()
  await details.getByRole("button", { name: "No changes", exact: true }).click()
  await expect(details).toBeHidden()
  await expect(tabs.getByRole("tab", { selected: true })).toHaveText("Changes")
  await more.click()
  await views.getByRole("button", { name: "Files", exact: true }).click()
  await expect(
    page.getByRole("tablist", { name: "Open files", exact: true }).getByRole("tab", { name: "README.md", exact: true }),
  ).toHaveAttribute("aria-selected", "true")

  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(readme).toHaveAttribute("aria-selected", "true")

  // The file tab survives reload and remains available when the layout narrows.
  await page.reload()
  await expect(readme).toHaveAttribute("aria-selected", "true")
  await page.setViewportSize({ width: 390, height: 844 })
  await more.click()
  await views.getByRole("button", { name: "Files", exact: true }).click()
  const files = page.locator('[data-slot="session-mobile-files"]')
  await expect(files.getByText("contents:README.md", { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(readme).toHaveAttribute("aria-selected", "true")
})

test("a narrow-screen palette pick keeps the view and dock, and the side region shows the file when wide", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockStressTimeline(page, {
    fileList: (path) => (path ? [] : [fileNode(fixture.directory, "README.md")]),
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    findFiles: ({ query }) => ("README.md".includes(query) ? [fileNode(fixture.directory, "README.md")] : []),
    pty: {},
  })
  await openStress(page, { lastProject: { local: fixture.directory } })
  await page.goto(sessionHref(fixture.targetID))

  const tabs = page.getByRole("tablist", { name: "Session view", exact: true })
  const terminal = page.locator("#terminal-panel")
  const views = page.getByRole("dialog", { name: "More options", exact: true })
  await tabs.getByRole("tab", { name: "More...", exact: true }).click()
  await views.getByRole("button", { name: "Terminal", exact: true }).click()
  await expect(views).toBeHidden()
  await expect(terminal.locator("textarea")).toBeEditable()
  await page.keyboard.press("ControlOrMeta+p")
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("textbox").fill("README")
  await dialog.getByRole("option", { name: "/ README.md", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(tabs.getByRole("tab", { selected: true })).toHaveText("More...")
  await expect(terminal).toBeVisible()

  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(terminal).toBeVisible()
  const panel = page.getByRole("complementary", { name: "Review and files", exact: true })
  await expect(panel.getByRole("tab", { name: "README.md", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("contents:README.md", { exact: true })).toBeVisible()
})

test.describe("touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test.beforeEach(async ({ page }) => {
    await mockStressTimeline(page)
    await openStress(page)
    await page.goto("/")
    await expect(page.locator('[data-component="home-session-row"]')).toHaveCount(rows)
  })

  test("mobile project selection and drawer navigation preserve session identity", async ({ page }) => {
    const projects = page.getByRole("button", { name: /^Projects:/ })
    await projects.click()
    const picker = page.getByRole("dialog", { name: "Projects", exact: true })
    await expect(picker.getByRole("button", { name: "All projects", exact: true })).toBeVisible()
    await picker.getByRole("button", { name: fixture.project.name, exact: true }).click()
    await expect(picker).toBeHidden()
    await expect(projects).toContainText(fixture.project.name)

    const trigger = page.locator('[data-slot="mobile-tabs-trigger"]')
    const drawer = page.locator('[data-slot="mobile-tabs-drawer"]')
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(drawer.locator('[data-slot="tab-project"]')).toHaveCount(0)
    await expect(drawer.getByRole("button", { name: "New session", exact: true })).toBeVisible()

    await drawer.locator('[data-slot="tab-link"]').filter({ hasText: fixture.expected.sourceTitle }).click()
    await expect(page).toHaveURL(new RegExp(`/session/${fixture.sourceID}$`))
    await expect(drawer).toBeHidden()
    await expect(trigger).toContainText(fixture.expected.sourceTitle)
    await trigger.click()
    await navigateFromMenu(page, "Home")
    await expect(page).toHaveURL("/")
    await expect(drawer).toBeHidden()
    await expect(page.locator('[data-component="home-session-row"]')).toHaveCount(rows)
  })

  test("mobile settings section menu stays above a full-width panel", async ({ page }) => {
    await navigateFromMenu(page, "Settings")
    const settings = page.getByTestId("settings-screen")
    const menu = settings.getByRole("combobox", { name: "Preferences", exact: true })
    const panel = settings.getByRole("tabpanel")
    await expect(settings.getByRole("heading", { name: "General", exact: true })).toBeVisible()
    await expect(page).toHaveURL("/settings")
    const more = page
      .getByRole("navigation", { name: "Mobile navigation", exact: true })
      .getByRole("button", { name: "More", exact: true })
    await expect(more.locator("..")).toHaveAttribute("aria-current", "page")
    await expect(menu).toBeVisible()
    await menu.click()
    await expect(menu).toHaveValue("general")
    await page.keyboard.press("Escape")
    await expect(menu).toHaveValue("general")
    await expect(settings).toBeVisible()
    await menu.selectOption("models")
    await expect(settings.getByRole("heading", { name: "Models", exact: true })).toBeVisible()
    await expect(settings.getByRole("combobox", { name: "Models", exact: true })).toBeVisible()
    await expect(settings.getByRole("switch", { name: "Claude Opus 4.6", exact: true })).toBeAttached()
    await expect
      .poll(async () => {
        const navigation = await settings.getByRole("combobox", { name: "Models", exact: true }).boundingBox()
        const content = await panel.boundingBox()

        return !!navigation && !!content && navigation.y + navigation.height <= content.y
      })
      .toBe(true)
    await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBeGreaterThan(350)
    await settings.getByRole("button", { name: "Back to app", exact: true }).click()
    await expect(page).toHaveURL("/")
    await expect(more.locator("..")).not.toHaveAttribute("aria-current")
    await expect(settings).toBeHidden()
    await expect(page.locator('[data-component="home-session-row"]')).toHaveCount(rows)
  })

  test.describe("tab drawer", () => {
    test.beforeEach(async ({ page }) => {
      await page.locator('[data-slot="mobile-tabs-trigger"]').click()
      await expect(page.locator('[data-slot="mobile-tabs-drawer"]')).toBeVisible()
      const drawer = page.locator('[data-slot="mobile-drawer-content"]')
      await expect
        .poll(() => drawer.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42))
        .toBe(0)
      await expect(drawer).not.toHaveAttribute("data-transitioning")
    })

    test("reorders session tabs with touch", async ({ page }) => {
      const tabs = page.locator('[data-slot="vertical-tabs"] a')
      await expect(tabs).toContainText([fixture.expected.sourceTitle, fixture.expected.targetTitle])
      const target = tabs.filter({ hasText: fixture.expected.targetTitle })
      const source = tabs.filter({ hasText: fixture.expected.sourceTitle })
      const targetBox = await target.boundingBox()
      const sourceBox = await source.boundingBox()
      expect(targetBox).not.toBeNull()
      expect(sourceBox).not.toBeNull()

      await touchDrag(page, source, {
        from: { x: sourceBox!.x + sourceBox!.width / 2, y: sourceBox!.y + sourceBox!.height / 2 },
        to: { x: targetBox!.x + targetBox!.width / 2, y: targetBox!.y + targetBox!.height / 2 },
      })

      await expect(tabs).toContainText([fixture.expected.targetTitle, fixture.expected.sourceTitle])
    })

    test("dismisses a touch context menu by tapping outside", async ({ page }) => {
      const drawer = page.locator('[data-slot="mobile-tabs-drawer"]')
      const tab = drawer.locator('[data-slot="tab-link"]').filter({ hasText: fixture.expected.sourceTitle })
      const homeBox = await page
        .getByRole("dialog", { name: "Tabs", exact: true })
        .locator('[data-slot="mobile-drawer-handle"]')
        .boundingBox()
      const box = await tab.boundingBox()
      expect(homeBox).not.toBeNull()
      expect(box).not.toBeNull()
      const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
      const touch = { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: point.x, clientY: point.y }

      await tab.dispatchEvent("pointerdown", touch)
      const rename = page.getByRole("menuitem", { name: "Rename", exact: true })
      await expect(rename).toBeVisible()
      await expect(drawer).toBeVisible()
      await tab.filter({ visible: true }).dispatchEvent("pointerup", touch)

      await page.touchscreen.tap(homeBox!.x + homeBox!.width / 2, homeBox!.y + homeBox!.height / 2)
      await expect(rename).toBeHidden()
      await expect(drawer).toBeVisible()
    })
  })
})

async function navigateFromMenu(page: Page, name: string) {
  const drawer = page.getByRole("dialog", { name: "Tabs", exact: true })
  if (await drawer.isVisible()) {
    await expect(page.locator('[data-slot="mobile-drawer-content"][data-open]')).not.toHaveAttribute(
      "data-transitioning",
    )
    await page.keyboard.press("Escape")
    await expect(drawer).toBeHidden()
  }
  const navigation = page.getByRole("navigation", { name: "Mobile navigation", exact: true })
  if (["Home", "Agents", "Search"].includes(name)) {
    await navigation.getByRole("button", { name, exact: true }).click()
    return
  }
  await navigation.getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}

async function touchDrag(
  page: Page,
  source: Locator,
  input: { from: { x: number; y: number }; to: { x: number; y: number } },
) {
  const client = await page.context().newCDPSession(page)
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...input.from, id: 1 }] })
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: (input.from.x + input.to.x) / 2, y: (input.from.y + input.to.y) / 2, id: 1 }],
  })
  await expect(source).toHaveCount(2)
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...input.to, id: 1 }] })
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
}
