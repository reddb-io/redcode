import { test, expect } from "@playwright/test"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import {
  installStressSessionTabs,
  installTimelineSettings,
  mockStressTimeline,
  stressSessionHref,
} from "../performance/timeline/timeline-test-helpers"

for (const width of [1280, 390]) {
  test(`shows S1/S2 and this session's unresolved evaluation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await mockStressTimeline(page)
    await installTimelineSettings(page)
    await installStressSessionTabs(page)
    const histories: string[] = []
    await page.route("**/api/intelligence**", async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith("/evaluations")) {
        histories.push(url.searchParams.get("sessionID") ?? "")
        return route.fulfill({
          json: [
            {
              id: "eval_session_only",
              fingerprint: "fixture",
              sessionID: fixture.sourceID,
              operation: "tool_usage",
              decision: "unavailable",
              model: "jev-a-long-model-name-to-check-truncation",
              answers: {},
              issues: ["System One authentication failed (HTTP 401)."],
              created: 1,
              duration: 12,
              policy: "test",
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          ],
        })
      }
      return route.fulfill({
        json: {
          settings: {
            enabled: true,
            onboarding: "completed",
            principal: { providerID: "opencode", id: "claude-opus-4-6" },
            evaluator: {
              transport: "typesafe",
              baseURL: "https://api.typesafe.ai/v1",
              model: "jev-a-long-model-name-to-check-truncation",
            },
          },
          environment: "/test",
          evaluators: [],
          effective: { reasoning: "dual", source: "config" },
        },
      })
    })
    await page.goto(stressSessionHref(fixture.sourceID))
    const trigger = page.getByRole("button", { name: "System One / System Two", exact: true })
    await expect(trigger).toContainText("S1")
    await expect(page.locator('[data-action="prompt-model"]')).toContainText("S2")
    await expect(trigger).toBeInViewport()
    await expect(page.locator('[data-action="prompt-submit"]')).toBeInViewport()
    for (const control of [
      trigger,
      page.locator('[data-action="prompt-model"]'),
      page.locator('[data-action="prompt-submit"]'),
    ]) {
      const box = await control.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    }
    await trigger.click()
    const details = page.getByRole("dialog", { name: "System One / System Two" })
    await expect(details.getByText("Reuse global S2", { exact: true })).toBeVisible()
    await expect(details.getByRole("heading", { name: "Session evaluations" })).toBeVisible()
    await details.locator("summary").filter({ hasText: "Tool usage" }).click()
    await expect(details.getByText("System One authentication failed (HTTP 401).", { exact: true })).toBeVisible()
    expect(histories.length).toBeGreaterThan(0)
    expect(histories.every((id) => id === fixture.sourceID)).toBe(true)
    const screenshot = testInfo.outputPath(`system-one-roles-${width}.png`)
    await page.screenshot({ path: screenshot })
    await testInfo.attach("S1/S2 session details", { path: screenshot, contentType: "image/png" })
  })
}
