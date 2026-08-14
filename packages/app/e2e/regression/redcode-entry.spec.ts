import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/RedCode/Entry"

test("opens directly into an unpersisted RedCode chat draft", async ({ page }) => {
  let sessionWrites = 0
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === "POST" && (path === "/session" || path === "/api/session")) sessionWrites++
  })
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_redcode_entry",
      worktree: directory,
      vcs: "git",
      name: "redcode-entry",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ directory }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode-theme-id", "oc-2")
      localStorage.setItem("opencode-color-scheme", "dark")
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem("opencode.window.browser.dat:tabs", JSON.stringify([]))
    },
    { directory },
  )

  await page.goto("/")

  const composer = page.locator('[data-component="prompt-input-v2"]')
  await expectAppVisible(composer)
  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  await expect(page.locator('[data-slot="redcode-wordmark"]')).toBeVisible()
  await expect(page.locator('[data-slot="redcode-wordmark-text"]')).toHaveText("redcode")
  await expect(page.locator('[data-component="session-draft-timeline"]')).toBeVisible()
  await expect(page.locator('[data-component="session-new-design"] [data-slot="wordmark-v2"]')).toHaveCount(0)
  expect(sessionWrites).toBe(0)

  const panel = await page.locator('[data-component="session-new-design"]').boundingBox()
  const prompt = await composer.boundingBox()
  if (!panel || !prompt) throw new Error("RedCode draft geometry is unavailable")
  expect(prompt.y).toBeGreaterThan(panel.y + panel.height / 2)

  await page.getByRole("button", { name: "Home" }).click()
  await expect(page).toHaveURL(/\?view=home$/)
  await expect(page.locator('[data-slot="redcode-wordmark"]')).toBeVisible()
})
