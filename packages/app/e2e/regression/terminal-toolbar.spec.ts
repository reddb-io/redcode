import { expect, test } from "@playwright/test"
import { openSession } from "../utils/workspace"

test("keeps workbench and terminal controls on one row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { pty } = await openSession(page, { name: "TerminalToolbar", pty: {} })
  await page.keyboard.press("Control+Backquote")

  const group = page.locator('[data-component="workbench-group"]').filter({ has: page.locator("#terminal-panel") })
  const toolbar = group.locator('[data-slot="terminal-tabs-toolbar"]')
  const panelTab = group.getByRole("tab", { name: "Terminal", exact: true })
  const terminalTab = toolbar.getByRole("tab", { name: "Terminal 1", exact: true })
  await expect(terminalTab).toBeVisible()
  const panelBox = (await panelTab.boundingBox())!
  const terminalBox = (await terminalTab.boundingBox())!
  expect(Math.abs(panelBox.y - terminalBox.y)).toBeLessThanOrEqual(4)

  await toolbar.getByRole("button", { name: "New terminal", exact: true }).click()
  await expect(toolbar.getByRole("tab", { name: "Terminal 2", exact: true })).toHaveAttribute("aria-selected", "true")
  await terminalTab.click()
  await expect(terminalTab).toHaveAttribute("aria-selected", "true")
  expect(pty.created).toHaveLength(2)

  await group.getByRole("button", { name: "Open a panel", exact: true }).click()
  await expect(toolbar).toBeHidden()
  await group.getByRole("button", { name: "Open a panel", exact: true }).click()
  await expect(terminalTab).toBeVisible()
})
