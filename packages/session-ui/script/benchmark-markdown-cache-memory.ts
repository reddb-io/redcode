// Synthetic upper-volume screen of the actual cache in a fresh Bun process.
// This is not a Chromium/Electron heap or total application RAM measurement.
import { getCachedMarkdown, touchCachedMarkdown } from "../src/components/markdown-cache"

const count = 200
const charactersPerString = 64 * 1024
const sample = () => {
  Bun.gc(true)
  Bun.gc(true)
  return process.memoryUsage()
}
const before = sample()
for (let index = 0; index < count; index++) {
  const raw = Buffer.alloc(charactersPerString / 2, index).toString("hex")
  const html = Buffer.alloc(charactersPerString / 2, 255 - index).toString("hex")
  touchCachedMarkdown(`fixture-${index}`, { raw, html, hash: String(index) })
}
const after = sample()
let retained = 0
for (let index = 0; index < count; index++) {
  const entry = getCachedMarkdown(`fixture-${index}`)
  if (entry) retained += entry.raw.length + entry.html.length
}
console.log(JSON.stringify({
  environment: { platform: process.platform, bun: Bun.version, scope: "synthetic Bun process" },
  count, charactersPerString, retainedCodeUnits: retained,
  before: { heapUsed: before.heapUsed, rss: before.rss },
  after: { heapUsed: after.heapUsed, rss: after.rss },
  delta: { heapUsed: after.heapUsed - before.heapUsed, rss: after.rss - before.rss },
}, null, 2))
