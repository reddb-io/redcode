import { benchmark, expect } from "../benchmark"
import { provider } from "../../utils/app"
import { openDraft } from "../../utils/workspace"

benchmark("measures interactions with a large model catalog", async ({ page, report }) => {
  benchmark.setTimeout(120_000)
  const count = 1000
  await page.setViewportSize({ width: 1440, height: 900 })
  await openDraft(page, {
    name: "LargeModelPicker",
    provider: provider(
      ...Array.from({ length: count }, (_, index) => ({
        id: `model-${index}`,
        name: `Model ${String(index).padStart(4, "0")}`,
        cost: { input: 1, output: 2 },
      })),
    ),
  })
  const trigger = page.locator('[data-action="composer-model"]')
  await trigger.click()
  const popup = page.getByRole("dialog", { name: "Select model", exact: true })
  const search = popup.getByRole("searchbox", { name: "Search models" })
  await expect(search).toBeVisible()
  const rows = await popup.locator('[data-slot="model-row"]').count()
  const sample = async (action: () => Promise<void>, eventName: string) => {
    await page.evaluate((name) => {
      const win = window as Window & { pickerTiming?: number }
      win.pickerTiming = undefined
      document.addEventListener(name, () => {
        const start = performance.now()
        requestAnimationFrame(() => requestAnimationFrame(() => (win.pickerTiming = performance.now() - start)))
      }, { once: true, capture: true })
    }, eventName)
    await action()
    await expect.poll(() => page.evaluate(() => (window as Window & { pickerTiming?: number }).pickerTiming)).toBeDefined()
    return page.evaluate(() => (window as Window & { pickerTiming?: number }).pickerTiming)
  }
  const hover = await sample(() => popup.getByRole("menuitemradio").nth(1).hover(), "mouseover")
  const typing = await sample(() => search.fill("Model 0999"), "input")
  await expect(popup.getByRole("menuitemradio", { name: /Model 0999/ })).toBeVisible()
  report({ renderedRows: rows, hoverMs: hover, searchMs: typing }, { models: count, metric: "event to second animation frame" })
})
