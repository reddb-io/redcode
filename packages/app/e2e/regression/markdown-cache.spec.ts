import { expect, test } from "@playwright/test"
import path from "node:path"

test.skip(Boolean(process.env.CI) || process.env.PLAYWRIGHT_BUILD === "1", "Requires Vite's source-module server")

test("preloads and rerenders Markdown after cache eviction", async ({ page }) => {
  await page.route("**/markdown-cache-regression", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>isolated markdown cache</title>" }),
  )
  await page.goto("/markdown-cache-regression")
  const moduleURL = `/@fs/${path.resolve(import.meta.dirname, "../../../session-ui/src/components/markdown-cache.tsx").replaceAll("\\", "/")}`
  const result = await page.evaluate(async (url) => {
    const cache = await import(/* @vite-ignore */ url)
    const text = "Hello **world**"
    await cache.preloadMarkdown(text, "preloaded")
    const preloaded = cache.getReadyMarkdown({ raw: text, src: text }, "preloaded:0:full")
    const block = { raw: text, src: text }
    const first = await cache.renderCachedMarkdown(block, "rendered")
    const large = "x".repeat(6 * 1024 * 1024)
    for (let index = 0; index < 3; index++)
      cache.touchCachedMarkdown(`pressure-${index}`, { raw: large, html: "", hash: String(index) })
    const evicted = cache.getCachedMarkdown("rendered") === undefined
    const again = await cache.renderCachedMarkdown(block, "rendered")
    return { preloaded: preloaded?.html, first: first.html, again: again.html, evicted }
  }, moduleURL)
  expect(result.preloaded).toContain("<strong>world</strong>")
  expect(result.first).toContain("<strong>world</strong>")
  expect(result.evicted).toBe(true)
  expect(result.again).toBe(result.first)
})
