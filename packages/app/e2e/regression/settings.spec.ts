import { expect, test, type Page } from "@playwright/test"
import type { ConfigEntry, OpenCodeEvent, WorktreeDirectory } from "@opencode/client/promise"
import { NO_PROVIDER, REMOTE_SERVER, SERVER, holdRoute, project, seed, session, sessionHref } from "../utils/app"
import { fixture, installStressSessionTabs, mockStressTimeline } from "../utils/session-fixture"
import { mockAgentTasks } from "../utils/agent-task-fixture"
import { mockAgentTools, mockOpenCodeServer, mockUsageReporter } from "../utils/mock-server"
import { mockRemoteServer, mockWorkspace, openSettings, type WorkspaceInput } from "../utils/workspace"
import { mockHttpsAccess } from "../utils/https-fixture"
import { mockConnectionEdits } from "../utils/credential-fixture"
import { openProviderAuthentication } from "../utils/provider-auth-fixture"

const directory = "C:/Projects/settings-demo"

const projectID = "proj_settings_demo"

const sandboxes = Array.from({ length: 12 }, (_, index) => `${directory}/workspace-${index + 1}`)

const override =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='16' height='16' fill='red'/%3E%3C/svg%3E"

test.use({ serviceWorkers: "block" })

// One project with 12 worktrees, each with one session, and a configured zsh shell.
function open(page: Page, input: Partial<WorkspaceInput> = {}) {
  return openSettings(page, {
    name: "Settings demo",
    directory,
    project: { icon: { color: "orange", override }, commands: { start: "echo setup" }, sandboxes },
    provider: NO_PROVIDER,
    configEntries: [
      { type: "document", path: "/home/test/.config/opencode/opencode.jsonc", info: { shell: "/bin/zsh" } },
      { type: "directory", path: "/home/test/.config/opencode" },
    ],
    shells: [
      { path: "/bin/zsh", name: "zsh", acceptable: true },
      { path: "/bin/bash", name: "bash", acceptable: true },
    ],
    sessions: sandboxes.map((item, index) => ({
      id: `ses_settings_${index + 1}`,
      title: `Workspace ${index + 1} session`,
      directory: item,
    })),
    ...input,
    seed: { tabs: [], ...input.seed },
  })
}

async function openProject(page: Page, name = "Settings demo") {
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Projects", exact: true }).click()
  await settings.getByRole("button", { name, exact: true }).click()
  await expect(settings.getByRole("button", { name: "Back to projects", exact: true })).toBeVisible()
}

const patched = (page: Page) =>
  page.waitForRequest(
    (request) => request.method() === "PATCH" && new URL(request.url()).pathname === `/api/project/${projectID}`,
  )

test("settings has its own route and returns through app history", async ({ page }) => {
  const { settings } = await open(page, { seed: { settings: { general: { showNavigation: true } } } })
  const home = page.getByRole("button", { name: "Home", exact: true })
  await expect(page).toHaveURL("/settings")
  await expect(home).toHaveAttribute("aria-pressed", "false")
  const history = page.locator('[data-slot="titlebar-history"]')
  const back = history.getByRole("button", { name: "Navigate back", exact: true })
  const forward = history.getByRole("button", { name: "Navigate forward", exact: true })
  await expect(forward).toBeDisabled()
  await back.click()
  await expect(page).toHaveURL("/")
  await expect(back).toBeDisabled()
  await forward.click()
  await expect(page).toHaveURL("/settings")
  await expect(forward).toBeDisabled()
  await settings.getByRole("button", { name: "Back to app", exact: true }).click()
  await expect(page).toHaveURL("/")
  await expect(home).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Control+]")
  await expect(page).toHaveURL("/settings")
  await expect(home).toHaveAttribute("aria-pressed", "false")
  await home.click()
  await expect(page).toHaveURL("/")
  await expect(settings).toBeHidden()
})

test("browser installation captures the prompt before Settings opens and handles dismissal and installation", async ({
  page,
}) => {
  const { settings } = await open(page)
  await expect(settings.getByText("Install Redcode", { exact: true })).toBeVisible()
  await expect(settings.getByText(/Use your browser's Install app/)).toBeVisible()
  await settings.getByRole("combobox", { name: "Search", exact: true }).fill("PWA")
  await page.getByRole("option", { name: "Install Redcode, Preferences / General", exact: true }).click()
  await settings.getByRole("combobox", { name: "Search", exact: true }).clear()
  await settings.getByRole("button", { name: "Back to app", exact: true }).click()

  for (const outcome of ["dismissed", "failed", "accepted"] as const) {
    await page.evaluate((outcome) => {
      const event = new Event("beforeinstallprompt", { cancelable: true })
      Object.assign(event, {
        prompt: async () => {
          if (outcome === "failed") throw new Error("Browser refused installation")
          if (outcome === "accepted") window.dispatchEvent(new Event("appinstalled"))
        },
        userChoice: Promise.resolve({ outcome: outcome === "accepted" ? "accepted" : "dismissed" }),
      })
      window.dispatchEvent(event)
    }, outcome)
    await page.getByRole("button", { name: "Settings", exact: true }).click()
    await settings.getByRole("button", { name: "Install app", exact: true }).click()
    await expect(settings.getByRole("button", { name: "Install app", exact: true })).toBeHidden()
    if (outcome !== "accepted") {
      await expect(
        settings.getByText(outcome === "failed" ? /Installation could not start/ : /Use your browser's Install app/),
      ).toBeVisible()
      await settings.getByRole("button", { name: "Back to app", exact: true }).click()
      continue
    }
    await expect(settings.getByText("Installed", { exact: true })).toBeVisible()
  }
})

test("HTTPS setup requires explicit relay consent, recovers from failure and pairs a phone through a secure link", async ({
  page,
}, testInfo) => {
  const { settings } = await open(page)
  const fixture = await mockHttpsAccess(page)
  await settings.getByRole("button", { name: "Configure HTTPS", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("status")).toHaveText("HTTPS access is off.")
  await expect(dialog.getByRole("button", { name: "Enable HTTPS", exact: true })).toBeDisabled()
  expect(fixture.operations).toEqual([])
  await dialog.getByRole("combobox", { name: "Connection service", exact: true }).selectOption("own")
  await dialog.getByRole("textbox", { name: "Relay API address", exact: true }).fill("https://relay.example.test")
  await expect(dialog.getByRole("button", { name: "Enable HTTPS", exact: true })).toBeDisabled()
  await dialog.getByText("I accept enabling internet access through the selected relay", { exact: true }).click()
  await expect(
    dialog.getByRole("switch", { name: "I accept enabling internet access through the selected relay", exact: true }),
  ).toBeChecked()
  await dialog.getByRole("button", { name: "Enable HTTPS", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("Could not complete HTTPS setup")
  await expect(dialog.getByRole("button", { name: "Create secure pairing link", exact: true })).toHaveCount(0)
  await dialog.getByRole("combobox", { name: "Connection service", exact: true }).selectOption("hosted")
  await expect(dialog.getByText(/Uses the external service at opentunnel.xyz/)).toBeVisible()
  await dialog.getByText("I accept enabling internet access through the selected relay", { exact: true }).click()
  await dialog.getByRole("button", { name: "Enable HTTPS", exact: true }).click()
  await expect(dialog.getByRole("status")).toHaveText("HTTPS access is ready.")
  expect(fixture.operations).toEqual([
    { method: "POST", relay: "https://relay.example.test", acceptExposure: true },
    { method: "POST", relay: "https://opentunnel.xyz", acceptExposure: true },
  ])
  await dialog.getByRole("button", { name: "Create secure pairing link", exact: true }).click()
  await expect(dialog.getByRole("textbox", { name: "Pairing link", exact: true })).toHaveValue(
    "https://device.secure.example.test/auth/connect/https-one-time-code",
  )
  await expect(dialog.getByRole("img", { name: "One-time server pairing QR code", exact: true })).toBeVisible()
  await expect(dialog.getByText(/On the secure page, choose Settings/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("https-desktop.png") })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(dialog.getByRole("button", { name: "Open secure link", exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("https-mobile.png") })
  await dialog.getByRole("button", { name: "Turn off HTTPS access", exact: true }).click()
  expect(fixture.operations.at(-1)).toEqual({ method: "pair" })
  await dialog.getByRole("button", { name: "Confirm turn off", exact: true }).click()
  await expect(dialog.getByRole("status")).toHaveText("HTTPS access is off.")
  expect(fixture.operations.at(-1)).toEqual({ method: "DELETE" })
  await expect(dialog.getByRole("button", { name: "Open secure link", exact: true })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(settings.getByRole("button", { name: "Configure HTTPS", exact: true })).toBeFocused()
})

test("pairing keeps its link through nested HTTPS settings and cancels an old grant before regenerating", async ({
  page,
}) => {
  const { settings } = await open(page)
  const fixture = await mockHttpsAccess(page)
  await settings.getByRole("tab", { name: "Server", exact: true }).click()
  const opener = settings.getByRole("button", { name: "Set up pairing", exact: true })
  await opener.click()
  const dialog = page.getByRole("dialog", { name: "Connect another device", exact: true })
  await dialog.getByRole("button", { name: "Use an existing tunnel or forwarded address", exact: true }).click()
  const address = dialog.getByRole("textbox", { name: "External server address", exact: true })
  await address.fill("https://pairing.example.test/not-an-origin")
  await expect(dialog.getByRole("button", { name: "Generate pairing link", exact: true })).toBeDisabled()
  await address.fill("https://pairing.example.test")
  await dialog.getByRole("button", { name: "Generate pairing link", exact: true }).click()
  const link = dialog.getByRole("textbox", { name: "Pairing link", exact: true })
  await expect(link).toHaveValue("https://pairing.example.test/auth/connect/https-one-time-code")
  const configure = dialog.getByRole("button", { name: "Configure HTTPS", exact: true })
  await configure.click()
  const nested = page.getByRole("dialog", { name: "HTTPS and mobile access", exact: true })
  await expect(nested.getByRole("status")).toHaveText("HTTPS access is off.")
  await nested.press("Escape")
  await expect(nested).toBeHidden()
  await expect(configure).toBeFocused()
  await expect(link).toHaveValue("https://pairing.example.test/auth/connect/https-one-time-code")
  await dialog.getByRole("button", { name: "Generate new link", exact: true }).click()
  await expect(link).toHaveValue("https://pairing.example.test/auth/connect/https-one-time-code-2")
  await dialog.getByRole("button", { name: "Cancel unused link", exact: true }).click()
  await expect(link).toHaveCount(0)
  expect(fixture.operations).toEqual([
    { method: "pair" },
    { method: "cancel", code: "https-one-time-code" },
    { method: "pair" },
    { method: "cancel", code: "https-one-time-code-2" },
  ])
  await dialog.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
})

test("Ctrl+, opens settings as soon as the app loads", async ({ page }) => {
  await mockWorkspace(page, {
    name: "Settings demo",
    directory,
    provider: NO_PROVIDER,
    sessions: [],
    seed: { tabs: [] },
  })
  await page.goto("/")
  await page.keyboard.press("Control+,")
  await expect(page.getByTestId("settings-screen")).toBeVisible()
  await expect(page).toHaveURL("/settings")
})

test("a settings page survives refresh", async ({ page }) => {
  const { settings } = await open(page)
  const appearance = settings.getByRole("tab", { name: "Appearance", exact: true })
  await appearance.click()
  await expect(page).toHaveURL("/settings?tab=appearance")
  await page.reload()
  await expect(appearance).toHaveAttribute("aria-selected", "true")
  await expect(page).toHaveURL("/settings?tab=appearance")
})

test("desktop density condenses navigation without shrinking text and preserves its choice across mobile and reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1560, height: 1000 })
  await mockStressTimeline(page)
  await installStressSessionTabs(page)
  await mockAgentTasks(page)
  await seed(page, { theme: { id: "oc-2", scheme: "dark" } })
  await page.goto(sessionHref(fixture.sourceID))
  await expect(page.locator("html")).toHaveAttribute("data-density", "tiny")
  await page.getByRole("button", { name: "Open delivery overview", exact: true }).click()
  const delivery = page.getByRole("region", { name: "Delivery", exact: true })
  await expect(delivery.getByText("Deliver a verified task workflow", { exact: true })).toBeVisible()
  const rail = page.getByRole("navigation", { name: "Navigation", exact: true })
  const row = page.locator(
    `[data-component="navigation-sidemenu"] [data-action="navigation-session"][data-session="${fixture.sourceID}"]`,
  )
  const density = page.getByRole("combobox", { name: "Desktop density", exact: true })
  const appearance = page.getByRole("tab", { name: "Appearance", exact: true })
  const returnToSession = async () => {
    await page.locator(`[data-titlebar-tab-link][href="${sessionHref(fixture.sourceID)}"]`).click()
    await expect(delivery.getByText("Deliver a verified task workflow", { exact: true })).toBeVisible()
  }
  const metrics = () =>
    row.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      font: getComputedStyle(element).fontSize,
      lineHeight: getComputedStyle(element).lineHeight,
      bodyFont: getComputedStyle(document.body).fontSize,
    }))
  await rail.getByRole("button", { name: "Settings", exact: true }).click()
  await appearance.click()
  await expect(density).toHaveValue("tiny")
  await density.selectOption("compact")
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact")
  await returnToSession()
  const compact = await metrics()
  await page.screenshot({ path: test.info().outputPath("desktop-density-compact.png"), fullPage: true })
  await rail.getByRole("button", { name: "Settings", exact: true }).click()
  await appearance.click()
  await density.selectOption("tiny")
  await expect(page.locator("html")).toHaveAttribute("data-density", "tiny")
  await returnToSession()
  const dense = await metrics()
  expect(dense.height).toBeLessThan(compact.height)
  expect(dense.font).toBe(compact.font)
  expect(dense.lineHeight).toBe(compact.lineHeight)
  expect(dense.bodyFont).toBe(compact.bodyFont)
  await page.screenshot({ path: test.info().outputPath("desktop-density-dense.png"), fullPage: true })
  await rail.getByRole("button", { name: "Settings", exact: true }).click()
  await appearance.click()
  await density.selectOption("comfortable")
  await page.reload()
  await expect(density).toHaveValue("comfortable")
  await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator("html")).toHaveAttribute("data-density", "tiny")
  await expect(density).toHaveValue("comfortable")
  const browse = page
    .getByRole("navigation", { name: "Mobile navigation", exact: true })
    .getByRole("button", { name: "Browse", exact: true })
  await expect(browse).toBeVisible()
  expect((await browse.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable")
})

test("appearance options remain reachable in a short viewport", async ({ page }) => {
  const { settings } = await open(page)
  await settings.getByRole("tab", { name: "Appearance", exact: true }).click()
  await page.setViewportSize({ width: 1280, height: 360 })
  const theme = settings.getByRole("combobox", { name: "Theme", exact: true })
  await expect(theme).toBeInViewport()
  await expect(theme.getByRole("option", { name: "Zenburn", exact: true })).toHaveCount(1)
  // Native selects let the browser keep the popup in view, including choices beyond the scrollport.
  await theme.selectOption("vesper")
  await theme.press("ArrowDown")
  await expect(theme).toHaveValue("zenburn")
  await expect(page.locator("html")).toHaveAttribute("data-color-theme", "zenburn")
  await page.screenshot({ path: test.info().outputPath("short-viewport-theme-options.png"), animations: "disabled" })
})

test("React settings keep preferences, fonts, color scheme, notifications and sounds across navigation and reload", async ({
  page,
}) => {
  const { settings } = await open(page)
  const detail = settings.getByRole("slider", { name: "Timeline detail", exact: true })
  await detail.focus()
  await detail.press("ArrowRight")
  await expect(detail).toHaveValue("3")
  await settings.getByRole("button", { name: "Advanced", exact: true }).click()
  const grouped = settings.getByRole("switch", { name: "Shell grouped", exact: true })
  await grouped.setChecked(false)
  const visibility = settings.getByRole("button", { name: "Shell visibility", exact: true })
  await visibility.click()
  await expect(visibility).toHaveAttribute("aria-pressed", "false")
  await expect(grouped).toHaveCount(0)
  await visibility.click()
  await expect(grouped).not.toBeChecked()
  const collapsed = settings.getByRole("switch", { name: "Shell collapsed", exact: true })
  await collapsed.setChecked(true)
  await settings.getByRole("tab", { name: "Appearance", exact: true }).click()
  await settings.getByRole("combobox", { name: "Color scheme", exact: true }).selectOption("light")
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
  for (const name of ["UI Font", "Code Font", "Terminal Font"]) {
    const input = settings.getByRole("textbox", { name, exact: true })
    await input.fill("monospace")
    await expect(input).toHaveValue("monospace")
  }
  await settings.getByRole("tab", { name: "Notifications", exact: true }).click()
  const agent = settings.getByRole("switch", { name: "Agent", exact: true })
  await agent.setChecked(false)
  await expect(agent).not.toBeChecked()
  await settings.getByRole("combobox", { name: "Agent", exact: true }).selectOption("none")
  await settings.getByRole("tab", { name: "Appearance", exact: true }).click()
  await expect(settings.getByRole("textbox", { name: "Code Font", exact: true })).toHaveValue("monospace")
  await page.reload()
  await expect(settings.getByRole("combobox", { name: "Color scheme", exact: true })).toHaveValue("light")
  await expect(settings.getByRole("textbox", { name: "UI Font", exact: true })).toHaveValue("monospace")
  await expect(settings.getByRole("textbox", { name: "Terminal Font", exact: true })).toHaveValue("monospace")
  await settings.getByRole("tab", { name: "Preferences", exact: true }).click()
  await expect(grouped).not.toBeChecked()
  await expect(visibility).toHaveAttribute("aria-pressed", "true")
  await expect(collapsed).toBeChecked()
  await settings.getByRole("tab", { name: "Notifications", exact: true }).click()
  await expect(agent).not.toBeChecked()
  await expect(settings.getByRole("combobox", { name: "Agent", exact: true })).toHaveValue("none")
  await agent.press("Space")
  await expect(agent).toBeChecked()
})

test("agent tools share host settings, install explicitly and preserve configuration across refresh", async ({
  page,
}, testInfo) => {
  const { settings } = await open(page)
  const tools = await mockAgentTools(page)
  await settings.getByRole("tab", { name: "Agent tools", exact: true }).click()
  await expect(settings.getByText(/Execution host: Windows workstation/)).toBeVisible()
  await expect(settings.getByRole("heading", { name: "Install and enable tools", exact: true })).toBeVisible()
  await expect(settings.getByText(/Installation downloads the package; it does not enable it for agents/)).toBeVisible()
  expect(tools.operations).toEqual([])
  const browser = settings.getByRole("region", { name: "Browser Control", exact: true })
  const enabled = browser.getByRole("switch", { name: "Enable for agents", exact: true })
  await expect(enabled).toBeDisabled()
  await expect(browser.getByText("Enable for agents", { exact: true })).toBeVisible()
  await expect(browser.getByRole("status")).toHaveText("Not installed · Unavailable to agents")
  await expect(browser.getByText(/choose Load unpacked and select that directory/)).toBeVisible()
  const computer = settings.getByRole("region", { name: "Computer Use", exact: true })
  await expect(computer.getByText(/Sign in to a graphical desktop on this host/)).toBeVisible()
  const terminal = settings.getByRole("region", { name: "Terminal Control", exact: true })
  await expect(terminal.getByRole("button", { name: "Install managed version", exact: true })).toBeDisabled()
  await browser.getByRole("button", { name: "Install managed version", exact: true }).click()
  await expect(enabled).toBeEnabled()
  await expect(enabled).not.toBeChecked()
  await expect(browser.getByRole("status")).toHaveText("Installed · Disabled for agents")
  await expect(browser.getByRole("button", { name: "Reinstall managed version", exact: true })).toBeEnabled()
  await expect(browser.getByLabel("Browser extension directory on this host", { exact: true })).toHaveValue(
    "/owned/browser/extension/dist",
  )
  await testInfo.attach("browser-tool-setup", { body: await browser.screenshot(), contentType: "image/png" })
  await enabled.focus()
  await enabled.press("Space")
  await expect(enabled).toBeChecked()
  await expect(browser.getByRole("status")).toHaveText("Installed · Enabled for agents")
  await browser.getByText("Options", { exact: true }).click()
  await browser.getByLabel("Custom command (JSON array)", { exact: true }).fill('["node", "/owned/mcp.js"]')
  await browser.getByLabel("Execution timeout (milliseconds)", { exact: true }).fill("45000")
  await browser.getByRole("button", { name: "Save", exact: true }).click()
  await expect(browser.getByRole("button", { name: "Run diagnostics", exact: true })).toBeEnabled()
  await browser.getByRole("button", { name: "Run diagnostics", exact: true }).click()
  await expect(browser.getByText("Owned fixture ready", { exact: true })).toBeVisible()
  await expect(browser.getByText(/Installed or enabled does not mean those steps are complete/)).toBeVisible()
  expect(tools.snapshot.tools.find((tool) => tool.id === "browser-control")?.settings).toEqual({
    enabled: true,
    command: ["node", "/owned/mcp.js"],
    timeout: 45000,
  })
  await page.reload()
  await expect(enabled).toBeChecked()
  await browser.getByText("Options", { exact: true }).click()
  await expect(browser.getByLabel("Execution timeout (milliseconds)", { exact: true })).toHaveValue("45000")
  await testInfo.attach("agent-tools", { body: await page.screenshot(), contentType: "image/png" })
})

test("agent tools operate on the selected remote host", async ({ page }) => {
  await mockRemoteServer(page, { directory: "/remote/settings-demo" })
  const { settings } = await open(page)
  const local = await mockAgentTools(page)
  const remote = await mockAgentTools(page, REMOTE_SERVER)
  await page.goto(`/settings?server=${encodeURIComponent(REMOTE_SERVER)}&tab=agent-tools`)
  await expect(settings.getByText(/Execution host: Remote Linux host/)).toBeVisible()
  await expect(settings.getByText(/Installation and actions happen on Remote Linux host/)).toBeVisible()
  const terminal = settings.getByRole("region", { name: "Terminal Control", exact: true })
  await expect(terminal.getByRole("button", { name: "Install managed version", exact: true })).toBeEnabled()
  await terminal.getByRole("button", { name: "Install managed version", exact: true }).click()
  await expect(terminal.getByRole("switch", { name: "Enable for agents", exact: true })).toBeEnabled()
  expect(remote.operations).toEqual(["install"])
  expect(local.operations).toEqual([])
})

test("usage reporting settings save on the selected server without returning the secret", async ({
  page,
}, testInfo) => {
  const { settings } = await open(page)
  const reporter = await mockUsageReporter(page)
  await settings.getByRole("tab", { name: "Usage reporting", exact: true }).click()
  await expect(page).toHaveURL("/settings?tab=reporting")
  await expect(settings.getByRole("heading", { name: "Usage reporting", exact: true })).toBeVisible()
  await settings.getByLabel("Destination URL", { exact: true }).fill("https://metrics.example.test/events")
  await settings.getByLabel("Signing secret", { exact: true }).fill("reporting-ui-secret")
  const toggle = settings.getByRole("switch", { name: "Enable reporting", exact: true })
  await toggle.focus()
  await toggle.press("Space")
  await expect(toggle).toBeChecked()
  await settings.getByRole("button", { name: "Save", exact: true }).click()
  await expect(settings.getByLabel("Signing secret", { exact: true })).toHaveValue("")
  expect(reporter.saved()).toEqual({
    enabled: true,
    transport: "webhook",
    url: "https://metrics.example.test/events",
    queue: "usage_events",
    secret: "reporting-ui-secret",
  })
  await expect(settings.getByText("A credential is saved. Leave blank to keep it.")).toBeVisible()
  await expect(settings.getByRole("button", { name: "Send pending reports", exact: true })).toBeEnabled()
  await page.reload()
  await expect(settings.getByLabel("Destination URL", { exact: true })).toHaveValue(
    "https://metrics.example.test/events",
  )
  await expect(settings.getByLabel("Signing secret", { exact: true })).toHaveValue("")
  await testInfo.attach("usage-reporting", { body: await page.screenshot(), contentType: "image/png" })
})

test("another server's settings page survives refresh", async ({ page }) => {
  await mockRemoteServer(page, { directory: "/remote/settings-demo" })
  const { settings } = await open(page)

  const url = (value: URL) =>
    value.pathname === "/settings" &&
    value.searchParams.get("server") === REMOTE_SERVER &&
    value.searchParams.get("tab") === "providers"

  await page.goto(`/settings?server=${encodeURIComponent(REMOTE_SERVER)}&tab=providers`)
  await expect(settings.getByRole("heading", { name: "Providers", exact: true })).toBeVisible()
  await expect(page).toHaveURL(url)
  await page.reload()
  await expect(settings.getByRole("heading", { name: "Providers", exact: true })).toBeVisible()
  await expect(page).toHaveURL(url)
})

test("server menus retain editing and removal policies", async ({ page }) => {
  await mockRemoteServer(page, { name: "Remote settings", directory: "/remote/settings-menu" })
  const { settings } = await open(page)
  await page.goto(`/settings?server=${encodeURIComponent(REMOTE_SERVER)}&tab=general`)
  const connection = settings.locator('[data-component="settings-server-connection"]')
  const more = connection.getByRole("button", { name: "More options", exact: true })
  await expect(connection).toContainText("Remote settings")
  await more.click()
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "Edit server", exact: true })
  await expect(editor.getByPlaceholder("Localhost", { exact: true })).toHaveValue("Remote settings")
  await editor.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(editor).toBeHidden()
  await expect(more).toBeFocused()
  await more.click()
  await expect(page.getByRole("menuitem", { name: "Hide from project list", exact: true })).toHaveCount(0)
  await expect(page.getByRole("menuitem", { name: "Remove", exact: true })).toBeEnabled()
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click()
  await expect(settings.getByRole("tab", { name: "Remote settings", exact: true })).toHaveCount(0)
  await expect(page).not.toHaveURL((url) => url.searchParams.get("server") === REMOTE_SERVER)
  await expect(settings).toBeVisible()
})

test("single-server settings expose scoped pages without a server picker", async ({ page }) => {
  const { settings } = await open(page)
  await expect(settings.getByRole("tab", { name: "Server", exact: true })).toBeVisible()
  await expect(settings.getByRole("tab", { name: "Servers", exact: true })).toHaveCount(0)

  for (const name of ["Projects", "Worktrees", "Providers", "Models", "Agent extensions"]) {
    await settings.getByRole("tab", { name, exact: true }).click()
    await expect(settings.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true")
    await expect(settings.locator('[data-action="settings-server-select"]')).toHaveCount(0)
  }

  await settings.getByRole("tab", { name: "Server", exact: true }).click()
  await expect(settings.getByText("Terminal shell", { exact: true })).toBeVisible()

  const updated = page.waitForRequest(
    (request) => request.method() === "PATCH" && new URL(request.url()).pathname === "/api/experimental/config",
  )

  await settings.getByRole("combobox", { name: "Terminal shell", exact: true }).selectOption("bash")
  expect((await updated).postDataJSON()).toEqual({ shell: "bash" })
})

test("project list menus rename, close, edit, add, and stay inside the scrollport", async ({ page }) => {
  const projects = ["rebase", "dinocms", "opencode", "Playground"].map((name, index) =>
    project({ id: `project-${index}`, directory: `/projects/${name}`, name }),
  )

  const { settings } = await open(page, {
    name: "rebase",
    directory: "/projects/rebase",
    project: { id: "project-0" },
    projects,
    sessions: [],
    fileList: () => [],
    seed: { projects: { local: projects.map((item) => ({ worktree: item.worktree, expanded: true })) } },
  })

  await settings.getByRole("tab", { name: "Projects", exact: true }).click()
  const panel = settings.getByRole("tabpanel")
  const list = panel.getByRole("list")
  await expect(list.getByRole("listitem")).toHaveCount(4)
  const card = list.getByRole("listitem").filter({ hasText: "rebase" })
  const more = card.getByRole("button", { name: "More options", exact: true })
  await more.click()
  const menu = page.getByRole("menu")
  await expect(menu.getByRole("menuitem")).toHaveText(["Edit", "Rename", "Clear notifications", "Close"])
  await menu.getByRole("menuitem", { name: "Edit", exact: true }).click()
  await expect(panel.getByRole("heading", { name: "rebase", exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "Back to projects", exact: true }).click()

  await page.setViewportSize({ width: 600, height: 720 })
  // Each project card stays fully inside every horizontal clip ancestor.
  await expect
    .poll(() =>
      card.evaluate((row) => {
        const bounds = row.getBoundingClientRect()
        const clips = []

        for (let parent = row.parentElement; parent; parent = parent.parentElement) {
          if (getComputedStyle(parent).overflowX === "visible") continue
          const clip = parent.getBoundingClientRect()
          clips.push(bounds.left - clip.left, clip.right - bounds.right)
        }

        return Math.min(...clips)
      }),
    )
    .toBeGreaterThanOrEqual(4)
  await expect(panel).toHaveJSProperty("scrollWidth", await panel.evaluate((element) => element.clientWidth))
  await page.setViewportSize({ width: 1280, height: 720 })

  await list
    .getByRole("listitem")
    .filter({ hasText: "dinocms" })
    .getByRole("button", { name: "More options", exact: true })
    .click()
  await page.getByRole("menuitem", { name: "Close", exact: true }).click()
  await expect(panel.getByRole("button", { name: "dinocms", exact: true })).toHaveCount(0)

  await more.click()
  await menu.getByRole("menuitem", { name: "Rename", exact: true }).click()
  const rename = panel.getByRole("textbox", { name: "Rename", exact: true })
  await expect(rename).toBeFocused()
  await rename.fill("Renamed project")

  const renamed = page.waitForRequest(
    (request) => request.method() === "PATCH" && new URL(request.url()).pathname === "/api/project/project-0",
  )

  await rename.press("Enter")
  expect((await renamed).postDataJSON()).toEqual({ name: "Renamed project" })
  await expect(panel.getByRole("button", { name: "Renamed project", exact: true })).toBeVisible()

  await panel.getByRole("button", { name: "Add project", exact: true }).click()
  const picker = page.getByRole("dialog", { name: "Open project", exact: true })
  await picker.getByRole("combobox").fill("/projects/added")
  await picker.getByRole("combobox").press("Enter")
  const select = picker.getByRole("button", { name: "Select folder", exact: true })
  await expect(select).toBeEnabled()
  await select.click()
  await expect(picker).toBeHidden()
  await expect(panel.getByRole("heading", { name: "added", exact: true })).toBeVisible()
})

test("project settings open as a nested view that keeps its route", async ({ page }) => {
  const { settings } = await open(page)
  await openProject(page)
  await expect(settings.getByRole("tab", { name: "General", exact: true })).toBeVisible()
  await expect(settings.getByRole("tab", { name: "Agent extensions", exact: true })).toBeVisible()
  await expect(settings.getByRole("tab", { name: "Scripts", exact: true })).toHaveCount(0)
  const menu = page.getByRole("menu")
  await settings.locator(".settings-tab-header").getByRole("button", { name: "More options", exact: true }).click()
  await expect(menu.getByRole("menuitem")).toHaveText(["Clear notifications", "Close"])
  // Escape must reach the menu, not the settings screen behind it.
  await expect.poll(() => menu.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(settings.getByRole("button", { name: "Back to projects", exact: true })).toBeVisible()

  await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
  await expect(settings.getByRole("heading", { name: "Worktrees", exact: true })).toBeVisible()

  const route = (url: URL) =>
    url.pathname === "/settings" &&
    url.searchParams.get("server") === SERVER &&
    url.searchParams.get("project") === directory &&
    url.searchParams.get("tab") === "workspaces"

  await expect(page).toHaveURL(route)
  await page.reload()
  await expect(settings.getByRole("heading", { name: "Worktrees", exact: true })).toBeVisible()
  await expect(page).toHaveURL(route)
  await page.keyboard.press("Escape")
  await expect(settings.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
})

for (const field of [
  {
    name: "color",
    label: "",
    initial: "orange",
    next: "blue",
    patches: [{ icon: { color: "blue", override: "" } }, { icon: { color: "orange", override: "" } }],
  },
  {
    name: "name",
    label: "Project name",
    initial: "Settings demo",
    next: "Renamed project",
    patches: [{ name: "Renamed project" }, { name: "Settings demo" }],
  },
  {
    name: "startup script",
    label: "Worktree startup script",
    initial: "echo setup",
    next: "bun install",
    patches: [{ commands: { start: "bun install" } }, { commands: { start: "echo setup" } }],
  },
]) {
  test(`project autosave keeps the final ${field.name} when reverting during a save`, async ({ page }) => {
    const { settings } = await open(page, {
      project: { icon: { color: "orange" }, commands: { start: "echo setup" }, sandboxes },
    })

    await openProject(page)
    const hold = await holdRoute(page, (url) => url.pathname === `/api/project/${projectID}`, { method: "PATCH" })

    const edit = async (value: string) => {
      if (field.name === "color") {
        await settings.getByRole("button", { name: `Select ${value} color`, exact: true }).click()

        return
      }

      const input = settings.getByRole("textbox", { name: field.label, exact: true })
      await input.fill(value)
      await input.blur()
    }

    await edit(field.next)
    await hold.arrived
    await edit(field.initial)
    expect(hold.requests.map((request) => request.postDataJSON())).toEqual([field.patches[0]])
    hold.release()
    await expect.poll(() => hold.requests.map((request) => request.postDataJSON())).toEqual(field.patches)
    await expect(settings.locator('[aria-busy="true"]')).toHaveCount(0)

    await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
    await settings.getByRole("tab", { name: "General", exact: true }).click()

    if (field.name === "color") {
      await expect(settings.getByRole("button", { name: "Select orange color", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      )

      return
    }

    await expect(settings.getByRole("textbox", { name: field.label, exact: true })).toHaveValue(field.initial)
  })
}

test("clearing project fields sends explicit removal values", async ({ page }) => {
  const { settings } = await open(page)
  await openProject(page)
  const startup = settings.getByRole("textbox", { name: "Worktree startup script", exact: true })
  await expect(startup).toHaveValue("echo setup")
  const icon = settings.getByRole("button", { name: "Project icon", exact: true })
  await expect(icon.locator("img")).toHaveCount(1)
  const color = settings.getByRole("button", { name: "Select orange color", exact: true })

  for (const step of [
    {
      act: async () => {
        await startup.clear()
        await startup.blur()
      },
      patch: { commands: { start: "" } },
    },
    { act: () => icon.click(), patch: { icon: { color: "orange", override: "" } } },
    {
      act: async () => {
        await expect(color).toHaveAttribute("aria-pressed", "true")
        await color.click()
      },
      patch: { icon: { color: "", override: "" } },
    },
  ]) {
    const saved = patched(page)
    await step.act()
    expect((await saved).postDataJSON()).toEqual(step.patch)
    await expect(settings.locator('[aria-busy="true"]')).toHaveCount(0)
  }
})

test("the new session shortcut waits for a shortcut recording, then leaves settings", async ({ page }) => {
  const { settings } = await open(page)
  await settings.getByRole("tab", { name: "Shortcuts", exact: true }).click()
  const binding = settings.locator('[data-keybind-id="tab.new"]')
  await binding.click()
  await expect(binding).toHaveText("Press keys")
  await page.keyboard.press("Control+t")
  await expect(binding).toHaveText("Ctrl+T")
  await expect(page).toHaveURL("/settings?tab=shortcuts")
  await expect(page.locator("[data-titlebar-tab]")).toHaveCount(0)

  await page.keyboard.press("Control+t")
  await expect(page).toHaveURL(/\/new-session\?draftId=.+$/)
  await expect(settings).toBeHidden()
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  await expect(page.locator('[data-titlebar-tab][data-active="true"]')).toHaveCount(1)
})

test.describe("pages open before slow data", () => {
  test("worktrees", async ({ page }) => {
    const { settings } = await open(page)
    const inventory = await holdRoute(page, (url) => url.pathname === "/api/worktree", { method: "GET" })

    const sessions = await holdRoute(
      page,
      (url) => url.pathname === "/api/session" && url.searchParams.has("directory"),
    )

    await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
    await inventory.arrived
    await expect(settings.getByRole("heading", { name: "Worktrees", exact: true })).toBeVisible()
    await expect(settings.getByRole("button", { name: "Back to app" })).toBeVisible()
    await expect(settings.getByText("No worktrees", { exact: true })).toHaveCount(0)

    inventory.release()
    await expect(settings.getByText(sandboxes[0]!, { exact: true })).toBeVisible()
    await expect(settings.getByText("12 worktrees", { exact: true })).toBeVisible()
    // Home already listed this session; it renders while the directory reads are still held.
    await sessions.arrived
    await expect(settings.getByText("Workspace 1 session", { exact: true })).toBeVisible()
    sessions.release()

    const refresh = await holdRoute(page, (url) => url.pathname === "/api/worktree", { method: "GET" })
    await settings.getByRole("tab", { name: "Preferences", exact: true }).click()
    await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
    await expect(settings.getByText("Workspace 1 session", { exact: true })).toBeVisible()
    refresh.release()
  })

  test("extensions", async ({ page }) => {
    const { settings } = await open(page, { mcp: [{ name: "demo-mcp", status: { status: "connected" } }] })
    const mcp = await holdRoute(page, (url) => url.pathname === "/api/mcp")
    await settings.getByRole("tab", { name: "Agent extensions", exact: true }).click()
    await mcp.arrived
    await expect(settings.getByRole("heading", { name: "Agent extensions", exact: true })).toBeVisible()
    await expect(settings.getByRole("button", { name: "Back to app" })).toBeVisible()
    mcp.release()
    await settings.getByRole("tab", { name: "MCPs", exact: true }).click()
    await expect(settings.getByRole("switch", { name: "demo-mcp" })).toBeChecked()
  })

  test("about identifies Redcode and keeps upstream credits and license notices", async ({ page }) => {
    const { settings } = await open(page)
    await settings.getByRole("tab", { name: "About", exact: true }).click()
    await expect(settings.getByText("Redcode is developed by reddb.io.", { exact: true })).toBeVisible()
    await expect(settings.getByText("Released under the MIT License", { exact: true })).toBeVisible()
    await expect(settings.getByRole("link", { name: "github.com/reddb-io/redcode", exact: true })).toHaveAttribute(
      "href",
      "https://github.com/reddb-io/redcode",
    )
    await expect(
      settings.getByRole("link", {
        name: "Based on OpenCode, an open-source project by Anomaly Innovations, Inc.",
        exact: true,
      }),
    ).toHaveAttribute("href", "https://github.com/anomalyco/opencode")
    await settings.getByRole("button", { name: "Third-party notices", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Third-party notices", exact: true })).toBeVisible()
    await page
      .getByRole("dialog", { name: "Third-party notices", exact: true })
      .getByRole("button", { name: "Close", exact: true })
      .click()
    await expect(settings.getByRole("button", { name: "Third-party notices", exact: true })).toBeFocused()
    await settings.getByRole("button", { name: "Third-party notices", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Third-party notices", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "Third-party notices", exact: true })).toBeHidden()
    await expect(settings.getByRole("button", { name: "Third-party notices", exact: true })).toBeFocused()
  })
})
test("worktrees follow inventory events, wait for session counts, and delete by project", async ({ page }) => {
  const empty = `${directory}/empty-workspace`
  const discovered = `${directory}/discovered-workspace`

  const inventory: WorktreeDirectory[] = [
    { directory },
    ...[...sandboxes, empty].map((item) => ({ directory: item, strategy: "git" })),
  ]

  const view = await open(page, {
    project: { sandboxes: [...sandboxes, empty] },
    worktrees: () => inventory,
    onWorktreeRemove: (body) => {
      inventory.splice(
        inventory.findIndex((item) => item.directory === body.directory),
        1,
      )
    },
  })

  const settings = view.settings

  // Holding every directory would fill the request budget; hold only the worktree without sessions.
  const sessions = await holdRoute(
    page,
    (url) => url.pathname === "/api/session" && url.searchParams.get("directory") === empty,
  )

  await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
  const row = settings.locator(".settings-workspaces-row").filter({ has: page.getByLabel(empty, { exact: true }) })
  await expect(row).toContainText("Loading messages")
  await settings.getByRole("button", { name: "More options", exact: true }).click()
  const menu = page.getByRole("menu", { name: "More options", exact: true })
  await expect(menu).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Delete worktrees without sessions", exact: true })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(settings).toBeVisible()
  sessions.release()
  await expect(row).toContainText("0 sessions")

  const listed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/worktree" && response.request().method() === "GET",
  )

  const read = page.waitForResponse((response) => {
    const url = new URL(response.url())

    return url.pathname === "/api/session" && url.searchParams.get("directory") === discovered
  })

  // Home never listed this session, so only the new worktree's directory read can show it.
  view.sessions.push(session({ id: "ses_discovered", directory: discovered, title: "Discovered session", projectID }))
  inventory.push({ directory: discovered, strategy: "git" })
  // SAFETY: a worktree.updated event carries only the project ID, which is all the app reads from it.
  await view.push([
    { id: "evt_settings_worktree_updated", created: Date.now(), type: "worktree.updated", data: { projectID } },
  ] as OpenCodeEvent[])
  expect((await listed).ok()).toBe(true)
  await expect(settings.getByText(discovered, { exact: true })).toBeVisible()
  expect((await read).ok()).toBe(true)
  await expect(settings.getByText("Discovered session", { exact: true })).toBeVisible()

  await openProject(page)
  await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
  await settings.getByRole("button", { name: "Delete “workspace-1”?", exact: true }).click()

  const deleting = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/worktree" && request.method() === "DELETE",
  )

  await page
    .getByRole("dialog", { name: "Delete “workspace-1”?", exact: true })
    .getByRole("button", { name: "Delete worktree", exact: true })
    .click()
  const request = await deleting
  expect(new URL(request.url()).searchParams.has("location[directory]")).toBe(false)
  expect(request.postDataJSON()).toEqual({ projectID, directory: sandboxes[0], force: true })
  await expect(settings.getByText("13 worktrees", { exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "Back to projects", exact: true }).click()
  await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
  await expect(settings.getByText("13 worktrees", { exact: true })).toBeVisible()
  await expect(settings.getByLabel(sandboxes[0]!, { exact: true })).toHaveCount(0)
})

test.describe("worktrees prefetch", () => {
  const other = project({ id: "proj_other", directory: "/repo/other", name: "Other project" })

  for (const interaction of ["hover", "focus"] as const) {
    test(`project Worktrees ${interaction} prefetches only its inventory and reuses the request`, async ({ page }) => {
      const { settings } = await open(page)
      await page.route(
        (url) => url.pathname === "/api/project",
        (route) => route.fulfill({ json: [project({ id: projectID, directory, sandboxes }), other] }),
      )
      const refreshes: string[] = []
      const sessions: string[] = []
      page.on("request", (request) => {
        const url = new URL(request.url())

        if (url.pathname === "/api/worktree/refresh") refreshes.push(request.postDataJSON().projectID)

        if (url.pathname === "/api/session" && url.searchParams.has("directory"))
          sessions.push(url.searchParams.get("directory")!)
      })
      await openProject(page)
      const inventory = await holdRoute(page, (url) => url.pathname === "/api/worktree", { method: "GET" })
      const calls = () => inventory.requests.map((request) => new URL(request.url()).searchParams.get("projectID"))
      const worktrees = settings.getByRole("tab", { name: "Worktrees", exact: true })
      await expect(worktrees).toBeEnabled()
      await worktrees[interaction]()
      await inventory.arrived
      await expect(worktrees).toHaveAttribute("aria-selected", "false")
      expect(calls()).toEqual([projectID])
      expect(sessions).toEqual([])

      if (interaction === "hover") {
        const finished = page.waitForEvent(
          "requestfinished",
          (request) => new URL(request.url()).pathname === "/api/worktree",
        )

        inventory.release()
        await finished
      }

      await worktrees.click()
      await expect(worktrees).toHaveAttribute("aria-selected", "true")
      inventory.release()
      await expect(settings.getByText("12 worktrees", { exact: true })).toBeVisible()
      expect(calls()).toEqual([projectID])
      expect(refreshes).toEqual([projectID])
      await expect.poll(() => sessions.toSorted()).toEqual(sandboxes.toSorted())
    })
  }

  test("server Worktrees hover only prefetches metadata", async ({ page }) => {
    const { settings } = await open(page)

    const calls = { projects: 0, worktrees: new Array<string>(), refreshes: new Array<string>() }

    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/worktree/refresh")
        calls.refreshes.push(request.postDataJSON().projectID)
    })
    await page.route(
      (url) => url.pathname === "/api/project",
      async (route) => {
        calls.projects += 1
        await route.fulfill({ json: [project({ id: projectID, directory, sandboxes }), other] })
      },
    )
    await page.route(
      (url) => url.pathname === "/api/worktree",
      async (route) => {
        const requested = new URL(route.request().url()).searchParams.get("projectID") ?? ""
        calls.worktrees.push(requested)

        if (requested === other.id) return route.fulfill({ json: [{ directory: other.worktree }] })
        await route.fallback()
      },
    )
    const worktrees = settings.getByRole("tab", { name: "Worktrees", exact: true })

    const fetched = page.waitForEvent(
      "requestfinished",
      (request) => new URL(request.url()).pathname === "/api/project",
    )

    await worktrees.hover()
    await fetched
    await worktrees.focus()
    await expect(worktrees).toHaveAttribute("aria-selected", "false")
    expect(calls).toEqual({ projects: 1, worktrees: [], refreshes: [] })

    await worktrees.click()
    await expect(settings.getByText("12 worktrees", { exact: true })).toBeVisible()
    expect(calls.projects).toBe(1)
    expect(calls.worktrees.toSorted()).toEqual([projectID, other.id].toSorted())
    expect(calls.refreshes).toEqual([])
  })
})

const lsp: ConfigEntry[] = [
  {
    type: "document",
    path: "/config/opencode.json",
    info: { lsp: { typescript: { command: ["typescript-language-server", "--stdio"], extensions: [".ts", ".tsx"] } } },
  },
  {
    type: "document",
    path: `${directory}/opencode.jsonc`,
    info: { lsp: { typescript: { disabled: true }, rust: { command: ["rust-analyzer"], extensions: [".rs"] } } },
  },
]

for (const row of ["configured", "disabled", "failure"] as const) {
  test(`project LSPs: ${row}`, async ({ page }) => {
    const { settings } = await open(page, {
      lspStatuses:
        row === "disabled"
          ? []
          : [
              { id: "typescript", root: directory, status: "connected" },
              { id: "rust", root: directory, status: "error", error: "Fixture server unavailable" },
            ],
    })
    await openProject(page)
    await settings.getByRole("tab", { name: "Agent extensions", exact: true }).click()
    const state = { fail: row === "failure" }
    const gate = Promise.withResolvers<void>()
    await page.route(
      (url) => url.pathname === "/api/config",
      async (route) => {
        await gate.promise

        if (state.fail) return route.fulfill({ status: 404, json: {} })
        await route.fulfill({ json: row === "disabled" ? [{ type: "document", info: { lsp: false } }] : lsp })
      },
    )
    const requested = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/config")
    await settings.getByRole("tab", { name: "LSPs", exact: true }).click()
    expect(new URL((await requested).url()).searchParams.get("location[directory]")).toBe(directory)
    const panel = settings.getByRole("tabpanel", { name: "LSPs", exact: true })
    await expect(panel.getByText("Loading", { exact: true })).toBeVisible()
    gate.resolve()

    if (row === "disabled") {
      await expect(panel.getByText("Language servers disabled", { exact: true })).toBeVisible()
      await expect(panel.locator(".project-settings-extension-row")).toHaveCount(0)

      return
    }

    if (row === "failure") {
      await expect(
        panel.getByText("Could not load language server configuration or status", { exact: true }),
      ).toBeVisible()
      state.fail = false
      await panel.getByRole("button", { name: "Retry", exact: true }).click()
    }

    const rows = panel.locator(".project-settings-extension-row")
    await expect(rows.filter({ hasText: "typescript" }).filter({ hasText: "Disabled in config" })).toBeVisible()
    await expect(rows.filter({ hasText: "typescript" }).filter({ hasText: "Disabled in config" })).toContainText(
      ".ts, .tsx",
    )
    await expect(rows.filter({ hasText: "rust" }).filter({ hasText: "Enabled in config" })).toBeVisible()
    const runtime = panel.getByRole("region", { name: "Language server status", exact: true })
    await expect(runtime.getByText("Connected", { exact: true })).toBeVisible()
    await expect(runtime.getByText("Connection error", { exact: true })).toBeVisible()
    await expect(runtime).toContainText("Fixture server unavailable")
    await expect(panel.getByRole("switch")).toHaveCount(0)
  })
}

// Zen and the Console account share the id `opencode`: the provider comes from models.dev, the
// integration carries the account sign-in.
for (const row of [
  { name: "a fresh install offers the Console sign-in", paid: false, connections: [], console: true },
  {
    name: "a stored Zen API key keeps the Console sign-in",
    paid: true,
    connections: [
      { type: "credential", id: "cred_v1", label: "API key", method: "key" },
      { type: "credential", id: "cred_backup", label: "Backup", method: "key" },
    ],
    console: true,
  },
  {
    name: "a Console account hides the sign-in row",
    paid: true,
    connections: [{ type: "credential", id: "cred_account", label: "Clara Team", method: "oauth" }],
    console: false,
  },
]) {
  test(`providers: ${row.name}`, async ({ page }) => {
    const connections = [...row.connections]
    const { settings } = await open(page, {
      provider: {
        all: [
          {
            id: "opencode",
            name: "OpenCode Zen",
            models: {
              "claude-sonnet-4-6": {
                id: "claude-sonnet-4-6",
                name: "Claude Sonnet 4.6",
                cost: { input: row.paid ? 3 : 0, output: 0 },
              },
            },
          },
        ],
        connected: ["opencode"],
        default: {},
      },
      integrations: [
        {
          id: "opencode",
          name: "OpenCode Console",
          methods: [
            { id: "device", type: "oauth", label: "OpenCode Console account" },
            { type: "key", label: "API key (service account)" },
          ],
          connections,
        },
        { id: "opencode-go", name: "OpenCode Go", methods: [{ type: "key" }], connections: [] },
        { id: "red-router", name: "RedRouter", methods: [{ type: "key" }], connections: [] },
        { id: "anthropic", name: "Anthropic", methods: [{ type: "key" }], connections: [] },
      ],
    })

    await settings.getByRole("tab", { name: "Providers", exact: true }).click()
    await expect(settings.getByRole("heading", { name: "Popular providers" })).toBeVisible()
    const connected = settings.locator('[data-component="connected-providers-section"]')

    if (row.paid) await expect(connected.getByText("OpenCode Zen", { exact: true })).toBeVisible()

    if (!row.paid) await expect(settings.getByText("No connected providers")).toBeVisible()
    // Anthropic only exists in the integration fixture, so its row proves the integration list has loaded.
    await expect(settings.getByText("Anthropic", { exact: true })).toBeVisible()
    const recommended = settings.locator(".settings-provider-row").filter({ hasText: "Recommended" })
    await expect(recommended).toHaveCount(1)
    await expect(recommended).toContainText("RedRouter")
    await expect(settings.getByText("OpenCode Console", { exact: true })).toHaveCount(row.console ? 1 : 0)
    if (connections.length < 2) return
    const operations: string[] = []
    await page.route("**/api/credential/cred_backup/activate", async (route) => {
      expect(route.request().method()).toBe("POST")
      operations.push("activate")
      const index = connections.findIndex((account) => account.id === "cred_backup")
      connections.unshift(...connections.splice(index, 1))
      await route.fulfill({ status: 204 })
    })
    await page.route("**/api/credential/cred_backup", async (route) => {
      expect(route.request().method()).toBe("DELETE")
      operations.push("remove")
      connections.splice(
        connections.findIndex((account) => account.id === "cred_backup"),
        1,
      )
      await route.fulfill({ status: 204 })
    })
    const account = connected.getByRole("combobox", { name: "Manage OpenCode Zen accounts", exact: true })
    await expect(account).toHaveValue("cred_v1")
    await account.selectOption("cred_backup")
    await expect(account).toHaveValue("cred_backup")
    await expect(account).toBeEnabled()
    await connected.getByRole("button", { name: "Manage OpenCode Zen accounts", exact: true }).click()
    await page.getByRole("menuitem", { name: "Backup", exact: true }).click()
    await expect(account).toHaveValue("cred_v1")
    await expect(account.getByRole("option")).toHaveCount(1)
    expect(operations).toEqual(["activate", "remove"])

    const edits = await mockConnectionEdits(page, connections)
    await connected.getByRole("button", { name: "Manage OpenCode Zen accounts", exact: true }).click()
    await page.getByRole("menuitem", { name: "Manage connections…", exact: true }).click()
    const management = page.getByRole("dialog", { name: "OpenCode Zen connections", exact: true })
    await management.getByRole("button", { name: "Rename API key", exact: true }).click()
    const rename = management.getByRole("textbox", { name: "Connection name", exact: true })
    await expect(rename).toBeFocused()
    await rename.fill("Cancelled name")
    await rename.press("Escape")
    await expect(management).toBeVisible()
    await expect(rename).toHaveCount(0)
    expect(edits.updates).toEqual([])
    await management.getByRole("button", { name: "Rename API key", exact: true }).click()
    await rename.fill("Production")
    await rename.press("End")
    await rename.pressSequentially(" key")
    await expect(rename).toHaveValue("Production key")
    await management.getByRole("button", { name: "Save", exact: true }).click()
    await expect(management.getByText("Production key", { exact: true })).toBeVisible()
    expect(edits.updates).toEqual([{ id: "cred_v1", label: "Production key" }])
    await management.getByRole("button", { name: "Test remote API", exact: true }).click()
    await expect(management.getByRole("status")).toContainText("Remote API test failed")
    await expect(management.getByRole("status")).toContainText("HTTP 503")
    await management.getByRole("button", { name: "Test remote API", exact: true }).click()
    await expect(management.getByRole("status")).toContainText("Remote API test passed")
    await expect(management.getByRole("status")).toContainText("HTTP 200")
    await management.press("Escape")
    await expect(management).toBeHidden()
    await expect(connected.getByRole("button", { name: "Manage OpenCode Zen accounts", exact: true })).toBeFocused()

    const removals: boolean[] = []
    await page.route("**/api/experimental/provider/opencode/remove", async (route) => {
      const request = route.request().postDataJSON()
      removals.push(request.dryRun)
      if (!request.dryRun && removals.filter((value) => !value).length === 1) {
        await route.fulfill({ status: 500, json: { message: "Temporary removal failure" } })
        return
      }
      if (!request.dryRun) connections.splice(0)
      await route.fulfill({
        json: {
          location: { directory, project: { id: projectID, directory, canonical: directory } },
          data: {
            providerID: "opencode",
            dryRun: request.dryRun,
            removed: { credentials: 1, config: false, references: [], learnedLimits: 0, hidden: false },
            configPath: "/home/test/.config/opencode/opencode.jsonc",
            referencingFiles: [],
            envVariables: [],
          },
        },
      })
    })
    await connected.getByRole("button", { name: "Manage OpenCode Zen accounts", exact: true }).click()
    await page.getByRole("menuitem", { name: "Remove provider…", exact: true }).click()
    const removal = page.getByRole("dialog", { name: "Remove OpenCode Zen", exact: true })
    await expect(removal).toContainText("1 saved credential")
    await removal.press("Escape")
    await expect(removal).toBeHidden()
    await expect(settings).toBeVisible()
    expect(removals).toEqual([true])
    await expect(connected.getByRole("button", { name: "Manage OpenCode Zen accounts", exact: true })).toBeFocused()
    await connected.getByRole("button", { name: "Manage OpenCode Zen accounts", exact: true }).click()
    await page.getByRole("menuitem", { name: "Remove provider…", exact: true }).click()
    const remove = removal.getByRole("button", { name: "Remove", exact: true })
    await remove.click()
    await expect.poll(() => removals.filter((value) => !value).length).toBe(1)
    await expect(remove).toBeEnabled()
    await expect(removal).toBeVisible()
    await remove.click()
    await expect(removal).toBeHidden()
    await expect(account).toHaveCount(0)
    expect(removals).toEqual([true, true, false, false])
  })
}

test("server sign-in keeps a failed password editable and opens the app after authentication", async ({ page }) => {
  await mockWorkspace(page, {
    name: "Server sign in",
    sessions: [],
    password: "fixture-server-password",
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  const screen = page.locator('[data-component="connect-server"]')
  await expect(screen).toBeVisible()
  await screen.getByRole("button", { name: "Use password", exact: true }).click()
  await screen.getByRole("textbox", { name: "Server address", exact: true }).fill(SERVER)
  const password = screen.getByLabel("Password", { exact: true })
  await password.fill("wrong-password")
  await screen.getByRole("button", { name: "Connect", exact: true }).click()
  await expect(screen.getByRole("alert")).toBeVisible()
  await expect(password).toBeEditable()
  await expect(password).toHaveValue("wrong-password")
  await password.fill("fixture-server-password")
  await password.press("Enter")
  await expect(screen).toHaveCount(0)
  await expect(page.locator('[data-action="home-new-session"]')).toBeVisible()
})

test("the add server dialog keeps focus above fullscreen settings", async ({ page }) => {
  await mockRemoteServer(page, { directory: "/remote/settings-demo" })
  const { settings } = await open(page)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await settings.locator('[data-component="settings-nav-group-header"]').filter({ hasText: "Servers" }).hover()
  await settings.getByRole("button", { name: "Add server" }).click()

  const editor = page.getByRole("dialog", { name: "Add server" })
  await expect(editor.getByLabel("Pairing link", { exact: true })).toBeFocused()
  await expect(editor.getByPlaceholder("password")).toHaveCount(0)
  await editor.getByRole("button", { name: "Use password", exact: true }).click()
  await expect(editor.getByPlaceholder("username")).toHaveCount(0)
  const name = editor.getByPlaceholder("Localhost", { exact: true })
  await name.click()
  await name.fill("Remote")
  await page.keyboard.press("Tab")
  await expect(editor.getByPlaceholder("password")).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(editor).toBeHidden()
  await expect(settings).toBeVisible()
})

const cameraTest = test.extend({
  browser: async ({ playwright }, use) => {
    // MediaStream capture requires full Chromium; the headless shell can enumerate a camera without opening it.
    const browser = await playwright.chromium.launch({
      channel: "chromium",
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    })
    await use(browser)
    await browser.close()
  },
})

cameraTest.describe("pairing camera lifecycle", () => {
  cameraTest.use({ permissions: ["camera"] })

  cameraTest("cancelling the QR scanner releases its camera stream and restores the pairing form", async ({ page }) => {
    await mockRemoteServer(page, { directory: "/remote/camera" })
    const { settings } = await open(page)
    await settings.locator('[data-component="settings-nav-group-header"]').filter({ hasText: "Servers" }).hover()
    await settings.getByRole("button", { name: "Add server" }).click()
    const dialog = page.getByRole("dialog", { name: "Add server", exact: true })
    await dialog.getByRole("button", { name: "Scan QR code", exact: true }).click()
    const video = dialog.getByLabel("Pairing camera", { exact: true })
    await expect
      .poll(() => video.evaluate((element) => (element as HTMLVideoElement).readyState))
      .toBeGreaterThanOrEqual(2)
    const stream = await video.evaluateHandle((element) => (element as HTMLVideoElement).srcObject as MediaStream)
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(video).toHaveCount(0)
    await expect
      .poll(() => stream.evaluate((stream) => stream.getTracks().every((track) => track.readyState === "ended")))
      .toBe(true)
    await stream.dispose()
    await expect(dialog.getByRole("textbox", { name: "Pairing link", exact: true })).toBeEditable()
    await dialog.press("Escape")
    await expect(dialog).toBeHidden()
  })
})

test("the add server dialog pairs from a one-time link and explains a spent one", async ({ page }) => {
  const paired = "http://127.0.0.1:4098"
  await mockRemoteServer(page, { directory: "/remote/settings-demo" })
  await mockOpenCodeServer(page, {
    server: paired,
    directory: "/remote/paired",
    project: project({ id: "proj_paired", directory: "/remote/paired" }),
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
    password: "session-token",
    pairing: { code: "one-time-code", token: "session-token" },
  })
  const { settings } = await open(page)
  const link = `${paired}/auth/connect/one-time-code`

  const addServer = async () => {
    await settings.locator('[data-component="settings-nav-group-header"]').filter({ hasText: "Servers" }).hover()
    await settings.getByRole("button", { name: "Add server" }).click()
    const editor = page.getByRole("dialog", { name: "Add server" })
    await editor.getByLabel("Pairing link", { exact: true }).fill(link)
    await editor.getByRole("button", { name: "Add server", exact: true }).click()

    return editor
  }

  const added = await addServer()
  await expect(added).toBeHidden()
  await expect(settings.getByText(paired, { exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "Back to settings" }).click()

  const spent = await addServer()
  await expect(spent.getByRole("alert")).toHaveText(
    "This pairing link expired or was already used. Run redcode pair to get a new one.",
  )
})

test("a pairing code with several addresses keeps the first one that works with its token", async ({ page }) => {
  // Both addresses reach one server. The second spends the code first, so the first answers 401, and the token works on
  // it as on every address of that server.
  const first = "http://127.0.0.1:4098"
  const second = "http://127.0.0.1:4099"
  await mockRemoteServer(page, { directory: "/remote/settings-demo" })

  for (const [server, pairing] of [
    [first, { code: "spent-by-the-other-address", token: "session-token" }],
    [second, { code: "one-time-code", token: "session-token" }],
  ] as const) {
    await mockOpenCodeServer(page, {
      server,
      directory: "/remote/paired",
      project: project({ id: "proj_paired", directory: "/remote/paired" }),
      provider: NO_PROVIDER,
      sessions: [],
      pageMessages: () => ({ items: [] }),
      password: "session-token",
      pairing,
    })
  }

  const { settings } = await open(page)
  await settings.locator('[data-component="settings-nav-group-header"]').filter({ hasText: "Servers" }).hover()
  await settings.getByRole("button", { name: "Add server" }).click()
  const editor = page.getByRole("dialog", { name: "Add server" })
  await editor
    .getByLabel("Pairing link", { exact: true })
    .fill(JSON.stringify({ code: "one-time-code", urls: [first, second] }))
  await editor.getByRole("button", { name: "Add server", exact: true }).click()

  await expect(editor).toBeHidden()
  await expect(settings.getByText(first, { exact: true })).toBeVisible()
  await expect(settings.getByText(second, { exact: true })).toHaveCount(0)
})

test("navigation labels preserve rail and panel geometry and survive reload", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const { settings } = await open(page)
  const rail = page.getByRole("navigation", { name: "Navigation", exact: true })
  const toggle = settings.getByRole("switch", { name: "Navigation labels", exact: true })
  const home = rail.getByRole("button", { name: "Home", exact: true })
  await expect(toggle).toBeChecked()
  await expect(home).toHaveText("Home")
  const labelledWidth = await rail.evaluate((element) => element.getBoundingClientRect().width)
  const aligned = async () => {
    const iconColumn = await rail.boundingBox()
    const sidebar = await page.getByRole("complementary", { name: "Projects and sessions", exact: true }).boundingBox()
    const main = await page.getByRole("main").boundingBox()
    return (
      !!iconColumn &&
      !!sidebar &&
      !!main &&
      Math.abs(iconColumn.x + iconColumn.width - sidebar.x) < 1 &&
      Math.abs(sidebar.x + sidebar.width - main.x) < 1
    )
  }
  await expect.poll(aligned).toBe(true)
  await home.focus()
  await home.press("ArrowDown")
  await expect(rail.getByRole("button", { name: "New session", exact: true })).toBeFocused()
  await toggle.focus()
  await toggle.press("Space")
  await expect(toggle).not.toBeChecked()
  await expect(home).toHaveText("")
  await expect.poll(() => rail.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(labelledWidth)
  await expect.poll(aligned).toBe(true)
  await page.reload()
  await expect(toggle).not.toBeChecked()
  await expect(home).toHaveText("")
  await expect.poll(aligned).toBe(true)
  await toggle.focus()
  await toggle.press("Space")
  await expect(home).toHaveText("Home")
  await expect.poll(aligned).toBe(true)
  await page.screenshot({ path: test.info().outputPath("labelled-navigation.png"), animations: "disabled" })
})

for (const viewport of [
  { name: "desktop", width: 1280, height: 720, bottom: false },
  { name: "mobile", width: 390, height: 844, bottom: true },
]) {
  test(`settings layout (${viewport.name}): every page scrolls inside its panel with room below`, async ({ page }) => {
    await page.route("https://api.github.com/repos/anomalyco/opencode/contributors?*", (route) =>
      route.fulfill({ json: [] }),
    )
    const { settings } = await open(page)
    await page.setViewportSize(viewport)
    const panel = settings.locator(".settings-content .settings-panel:visible")
    const main = page.getByRole("main")

    if (viewport.bottom) {
      const toggle = settings.getByRole("switch", { name: "Bottom navigation", exact: true })
      await toggle.check()
      await expect(toggle).toBeChecked()
    }

    // Use the far outer gutter; the near edge belongs to the sidebar's resize handle.
    await main.hover({ position: { x: await main.evaluate((element) => element.clientWidth - 2), y: 200 } })
    await page.mouse.wheel(0, 10000)
    await expect(main).toHaveJSProperty("scrollTop", 0)

    const pages = [
      "Preferences",
      "Appearance",
      "Notifications",
      "Shortcuts",
      "Projects",
      "Worktrees",
      "Providers",
      "Models",
      "Agent extensions",
      "Server",
      "About",
    ]

    for (const [index, name] of pages.entries()) {
      if (viewport.width >= 816) await settings.getByRole("tab", { name, exact: true }).click()

      if (viewport.width < 816) {
        await settings
          .getByRole("combobox", { name: pages[Math.max(0, index - 1)], exact: true })
          .selectOption({ label: name })
      }

      if (name === "About") await expect(panel.getByText("Released under the MIT License")).toBeVisible()

      if (name !== "About")
        await expect(
          panel.getByRole("heading", { name: name === "Shortcuts" ? "Keyboard shortcuts" : name, exact: true }),
        ).toBeVisible()

      if (name === "Worktrees") {
        const last = settings.getByText("Workspace 12 session", { exact: true })
        await last.scrollIntoViewIfNeeded()
        await expect(last).toBeInViewport()

        if (!viewport.bottom) await expect(settings.getByRole("button", { name: "Back to app" })).toBeInViewport()
      }

      await panel.hover()
      await page.mouse.wheel(0, 10000)
      await expect
        .poll(() => panel.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
        .toBeLessThanOrEqual(1)
      await expect
        .poll(
          () =>
            panel.evaluate((element) => {
              const body = element.querySelector(".settings-tab-body, .settings-about-content")!

              return element.getBoundingClientRect().bottom - body.lastElementChild!.getBoundingClientRect().bottom
            }),
          { message: `${name} bottom clearance` },
        )
        .toBeGreaterThanOrEqual(viewport.bottom ? 119.5 : 79.5)
      await expect(main).toHaveJSProperty("scrollTop", 0)
      await expect
        .poll(() => main.evaluate((element) => element.scrollWidth - element.clientWidth))
        .toBeLessThanOrEqual(1)
    }
  })
}

test("provider authentication keeps conditional answers, validates keys and starts with the selected first model", async ({
  page,
}) => {
  const fixture = await openProviderAuthentication(page)
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Providers", exact: true }).click()
  await settings.getByRole("button", { name: "Show more providers", exact: true }).click()
  const picker = page.getByRole("dialog", { name: "Connect provider", exact: true })
  const search = picker.getByRole("searchbox", { name: "Search providers", exact: true })
  await expect(search).toBeFocused()
  await expect(picker.getByRole("button", { name: /Environment only/ })).toBeDisabled()
  await expect(picker.getByText("MCP fixture", { exact: true })).toHaveCount(0)
  await search.fill("no-provider-match")
  await expect(picker.getByRole("status")).toHaveText("No providers found")
  await search.fill("RedRouter")
  await search.press("ArrowDown")
  await page.keyboard.press("Enter")
  const connect = page.getByRole("dialog", { name: "Connect RedRouter", exact: true })
  await expect(connect.getByRole("heading", { name: "Use a custom endpoint?", exact: true })).toBeVisible()
  const no = connect.getByRole("button", { name: "No", exact: true })
  await expect(no).toBeFocused()
  await no.press("ArrowDown")
  await page.keyboard.press("Enter")
  await connect.getByRole("radio", { name: "Type your own answer", exact: true }).check()
  const custom = connect.getByRole("textbox", { name: "Type your own answer", exact: true })
  await expect(custom).toBeFocused()
  await custom.fill("custom-region")
  await connect.getByRole("radio", { name: "West", exact: true }).check()
  await connect.getByRole("radio", { name: "Type your own answer", exact: true }).check()
  await expect(custom).toHaveValue("custom-region")
  await connect.getByRole("button", { name: "Continue", exact: true }).click()
  const port = connect.getByRole("textbox", { name: "Port", exact: true })
  await connect.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(port).toHaveAttribute("aria-invalid", "true")
  await expect(connect.getByRole("alert")).toHaveText("An answer is required")
  await port.fill("3.5")
  await port.press("Enter")
  await expect(connect.getByRole("alert")).toHaveText("Enter a whole number")
  await port.fill("4096")
  await port.press("Enter")
  const key = connect.getByRole("textbox", { name: "RedRouter API key", exact: true })
  await expect(key).toBeFocused()
  await key.press("Enter")
  await expect(connect.getByRole("alert")).toHaveText("API key is required")
  await key.fill("fixture-key")
  await key.press("Enter")
  await expect(connect.getByRole("alert")).toContainText("Fixture key rejected")
  await expect(key).toHaveValue("fixture-key")
  await key.press("Enter")
  const models = page.getByRole("dialog", { name: "Connected to RedRouter", exact: true })
  await expect(models.getByRole("radio", { name: "Fixture First", exact: true })).toBeChecked()
  await models.getByRole("radio", { name: "Fixture Second", exact: true }).check()
  await models.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(models).toBeHidden()
  await expect(
    page.locator('[data-component="composer"]').getByRole("button", { name: "Fixture Second", exact: true }),
  ).toBeVisible()
  expect(fixture.keys).toEqual(
    Array.from({ length: 2 }, () => ({
      key: "fixture-key",
      answer: { hidden: "retained", custom: true, region: "custom-region", port: 4096 },
    })),
  )
})

test("provider authentication cancels a login command and recovers an OAuth code without losing the attempt", async ({
  page,
}) => {
  const fixture = await openProviderAuthentication(page)
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Providers", exact: true }).click()
  const row = settings.locator(".settings-provider-row").filter({ hasText: "Anthropic" })
  const opener = row.getByRole("button", { name: "Connect", exact: true })
  await opener.click()
  const connect = page.getByRole("dialog", { name: "Connect Anthropic", exact: true })
  await connect.getByRole("button", { name: "CLI login", exact: true }).click()
  await expect(connect.getByText("fixture-provider login", { exact: true })).toBeVisible()
  await expect(connect.locator('[data-component="provider-command-output"]')).toHaveText(
    "Fixture CLI waiting for authorization",
  )
  await connect.getByRole("button", { name: "Navigate back", exact: true }).click()
  await expect(connect.getByRole("button", { name: /Browser login/ })).toBeVisible()
  await expect.poll(() => fixture.cancellations).toEqual(["command:con_fixture_command"])
  await connect.getByRole("button", { name: /Browser login/ }).click()
  const code = connect.getByRole("textbox", { name: "Browser login (browser) authorization code", exact: true })
  await expect(code).toBeFocused()
  await code.press("Enter")
  await expect(connect.getByRole("alert")).toHaveText("Authorization code is required")
  await code.fill("fixture-code")
  await code.press("Enter")
  await expect(connect.getByRole("alert")).toContainText("Fixture code rejected")
  await expect(code).toHaveValue("fixture-code")
  await code.press("Enter")
  await expect(connect).toBeHidden()
  await expect(opener).toBeFocused()
  expect(fixture.codes).toEqual([{ code: "fixture-code" }, { code: "fixture-code" }])
  expect(fixture.attempts).toEqual(["command", "oauth"])
})

test("Console authentication retains device code, key fallback and Escape cancellation on mobile", async ({ page }) => {
  const fixture = await openProviderAuthentication(page)
  fixture.state.mode = "auto"
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Providers", exact: true }).click()
  const opener = settings
    .locator(".settings-provider-row")
    .filter({ hasText: "OpenCode Console" })
    .getByRole("button", { name: "Connect", exact: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await opener.click()
  const connect = page.getByRole("dialog", { name: "Connecting to OpenCode Console", exact: true })
  await expect(connect.getByRole("group", { name: "Device code: ABCD-EFGH", exact: true })).toBeVisible()
  await expect(connect.getByRole("button", { name: "Copy sign-in link", exact: true })).toBeEnabled()
  await connect.getByRole("button", { name: "Use API key", exact: true }).click()
  await expect(connect.getByRole("textbox", { name: "OpenCode Console API key", exact: true })).toBeFocused()
  await expect.poll(() => fixture.cancellations).toEqual(["oauth:con_fixture_oauth"])
  await connect.getByRole("button", { name: "Navigate back", exact: true }).click()
  await expect(connect.getByRole("group", { name: "Device code: ABCD-EFGH", exact: true })).toBeVisible()
  await connect.press("Escape")
  await expect(connect).toBeHidden()
  await expect(opener).toBeFocused()
  await expect.poll(() => fixture.cancellations).toEqual(["oauth:con_fixture_oauth", "oauth:con_fixture_oauth"])
})
