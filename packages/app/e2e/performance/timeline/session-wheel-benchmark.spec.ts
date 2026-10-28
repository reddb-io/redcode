import { benchmark, expect } from "../benchmark"
import { setupTimelineBenchmark } from "./session-timeline-benchmark.fixture"
import {
  collectTimelineScrollMetrics,
  installTimelineScrollProbe,
  startTimelineScrollProbe,
} from "./session-timeline-scroll-probe"

benchmark.use({ viewport: { width: 1440, height: 900 }, video: "off", trace: "off", serviceWorkers: "block" })

benchmark("scrolls a long session using wheel input", async ({ page, report }) => {
  benchmark.setTimeout(300_000)
  if (process.env.SCROLL_BENCH_UNCONSTRAINED === "1") {
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style")
        style.textContent = `
          .md\\:max-w-session { max-width: none !important; margin-inline: 0 !important; }
          [data-slot="text-part-body"] [data-component="markdown"] :is(p, ul, ol, blockquote, h1, h2, h3, h4, h5, h6) { max-width: 72ch !important; }
          [data-slot="user-message-text"] { max-width: 96ch !important; }
        `
        document.head.append(style)
      }, { once: true })
    })
  }
  if (process.env.SCROLL_BENCH_CONTAIN_LAYOUT === "1") {
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style")
        style.textContent = '[data-timeline-virtual-content] { contain: layout; }'
        document.head.append(style)
      }, { once: true })
    })
  }
  const fixture = await setupTimelineBenchmark(page, { historyTurns: 320, eventBatch: 1 })
  await expect
    .poll(() =>
      fixture.scroller.evaluate(() => document.querySelector<HTMLElement>("[data-timeline-virtual-content]")?.style.visibility),
    )
    .not.toBe("hidden")
  const box = await fixture.scroller.boundingBox()
  if (!box) throw new Error("timeline scroller is not visible")
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2)
  await installTimelineScrollProbe(page)
  await startTimelineScrollProbe(page)
  for (let step = 0; step < 20; step++) await page.mouse.wheel(0, -500)
  await expect.poll(() => fixture.scroller.evaluate((element) => element.scrollTop)).toBeLessThan(
    await fixture.scroller.evaluate((element) => element.scrollHeight - element.clientHeight),
  )
  const metrics = await collectTimelineScrollMetrics(page)
  expect(metrics.scrolledPx).toBeGreaterThan(0)
  report(metrics, {
    historyTurns: 320,
    wheelEvents: 20,
    wheelDelta: -500,
    layout: process.env.SCROLL_BENCH_UNCONSTRAINED === "1" ? "previous" : "wide",
    containLayout: process.env.SCROLL_BENCH_CONTAIN_LAYOUT === "1",
    ...fixture.workload,
  })
})
