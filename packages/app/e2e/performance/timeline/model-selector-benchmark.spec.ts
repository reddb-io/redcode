import { benchmark, benchmarkDiagnostics, expect } from "../benchmark"
import { measureNavigationMilestones } from "./navigation-milestones"
import { installStressSessionTabs, mockStressTimeline } from "../../utils/session-fixture"

benchmark.use({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: "block",
  traceScope: "interaction",
  trace: "off",
  video: "off",
})

benchmark("open model selector from a new session", async ({ page, report }) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
  await page.goto("/")
  await page.locator('[data-action="home-new-session"]').click()
  const trigger = '[data-component="new-session"] [data-action="composer-model"]'
  await expect(page.locator(trigger)).toContainText("Claude Opus 4.6")
  await benchmarkDiagnostics(page).startTrace()
  const result = await measureNavigationMilestones(page, {
    triggerSelector: trigger,
    milestones: {
      search: { selector: '[role="dialog"] input[placeholder="Search models"]' },
      model: { selector: '[role="dialog"] [role="menuitemradio"]' },
    },
    navigate: () => page.locator(trigger).click(),
  })
  await benchmarkDiagnostics(page).stop()
  const dialog = page.getByRole("dialog", { name: "Select model", exact: true })
  await expect(dialog.getByRole("menuitemradio", { name: /Claude Opus 4\.6/ })).toBeVisible()
  await expect(dialog.getByPlaceholder("Search models", { exact: true })).toBeFocused()
  report(result, { entry: "new-session", data: "fixture", inputEvent: "mousedown" })
})
