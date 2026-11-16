import { benchmark, expect } from "../benchmark"
import path from "node:path"

benchmark.skip(Boolean(process.env.CI) || process.env.PLAYWRIGHT_BUILD === "1", "Requires Vite's source-module server")

benchmark("measures retained Markdown cache memory", async ({ page, report }) => {
  await page.route("**/markdown-cache-benchmark", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>isolated cache benchmark</title>" }),
  )
  await page.goto("/markdown-cache-benchmark")
  const moduleURL = `/@fs/${path.resolve(import.meta.dirname, "../../../../session-ui/src/components/markdown-cache.tsx").replaceAll("\\", "/")}`
  await page.evaluate((url) => import(/* @vite-ignore */ url).then(() => undefined), moduleURL)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("HeapProfiler.collectGarbage")
  const before = await cdp.send("Runtime.getHeapUsage")
  const result = await page.evaluate(async (url) => {
    const module = await import(/* @vite-ignore */ url)
    for (let index = 0; index < 200; index++) {
      const prefix = String(index).padStart(8, "0")
      const raw = prefix + "a".repeat(65528)
      const html = prefix + "b".repeat(65528)
      raw.charCodeAt(65535)
      html.charCodeAt(65535)
      module.touchCachedMarkdown(`fixture-${index}`, { raw, html, hash: String(index) })
    }
    let entries = 0
    let characters = 0
    for (let index = 0; index < 200; index++) {
      const entry = module.getCachedMarkdown(`fixture-${index}`)
      if (!entry) continue
      entries++
      characters += entry.raw.length + entry.html.length
    }
    return { entries, characters }
  }, moduleURL)
  await cdp.send("HeapProfiler.collectGarbage")
  const after = await cdp.send("Runtime.getHeapUsage")
  expect(result.entries).toBeGreaterThan(0)
  report({ before, after, ...result }, { scope: "isolated Chromium renderer; synthetic entries; explicit GC" })
  await cdp.detach()
})
