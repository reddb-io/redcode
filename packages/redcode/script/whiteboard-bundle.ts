#!/usr/bin/env bun
/**
 * The whiteboard bundle: Excalidraw, the Mermaid→Excalidraw converter with its exactly pinned
 * Mermaid, React, and the frame page's own code, as one script and one stylesheet, plus the fonts
 * Excalidraw fetches on demand. It is not part of the binary — several megabytes nobody needs
 * until a diagram is opened as a whiteboard — so a release ships it as a tarball the server
 * downloads on first use. `bun run build:whiteboard` produces dist/whiteboard/ for a checkout.
 *
 * Built in its own little project under node_modules/.cache, with its own install: React and Excalidraw are
 * not dependencies of redcode, and pulling them into the workspace would tangle them with the
 * React the terminal UI's dependencies expect. The pins are exact; the converter reaches into
 * Mermaid's internals and newer Mermaid versions silently degrade class, ER and state diagrams
 * to image fallbacks (mermaid-to-excalidraw#108), so a bump must be a deliberate re-probe.
 */
import { $ } from "bun"
import path from "path"
import { promises as fs } from "node:fs"

export const PINS = {
  "@excalidraw/excalidraw": "0.18.1",
  "@excalidraw/mermaid-to-excalidraw": "2.2.2",
  mermaid: "11.12.1",
  react: "18.2.0",
  "react-dom": "18.2.0",
} as const

const root = path.resolve(import.meta.dirname, "..")
const out = path.join(root, "dist", "whiteboard")
// Under node_modules/.cache, not dist/: dist/*/package.json is what the publish script reads as
// the binary packages, and this project is not one of them.
const work = path.join(root, "node_modules", ".cache", "redcode-whiteboard-build")
const version = process.env["REDCODE_VERSION"] ?? (await import("../package.json")).default.version

// The frame's sources, copied beside the install so bare imports resolve there and nowhere else.
await fs.mkdir(work, { recursive: true })
await Bun.write(
  path.join(work, "package.json"),
  JSON.stringify({ name: "redcode-whiteboard-build", private: true, type: "module", dependencies: PINS }, null, 2),
)
const frame = await fs.readFile(path.join(root, "src/design/whiteboard-frame/frame.js"), "utf8")
await Bun.write(path.join(work, "frame.js"), frame.replace('"../vendor/whiteboard-core.js"', '"./vendor/whiteboard-core.js"'))
await fs.copyFile(path.join(root, "src/design/whiteboard-frame/frame.css"), path.join(work, "frame.css"))
await fs.mkdir(path.join(work, "vendor"), { recursive: true })
await fs.copyFile(path.join(root, "src/design/vendor/whiteboard-core.js"), path.join(work, "vendor", "whiteboard-core.js"))
await $`bun install --silent`.cwd(work)

for (const [name, pinned] of Object.entries(PINS)) {
  const installed = (await import(path.join(work, "node_modules", name, "package.json"))).default.version
  if (installed !== pinned) throw new Error(`${name} resolved to ${installed}, not the pinned ${pinned}`)
}

await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(out, { recursive: true })

const result = await Bun.build({
  entrypoints: [path.join(work, "frame.js")],
  outdir: out,
  naming: "whiteboard.[ext]",
  target: "browser",
  format: "iife",
  minify: true,
  conditions: ["production", "browser"],
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.IS_PREACT": '"false"',
  },
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

// Excalidraw lazily fetches canvas fonts from `EXCALIDRAW_ASSET_PATH/fonts/`. Every family but
// Xiaolai (12 MB of CJK glyphs) ships; that one falls back to the system font when missing.
const families = ["Assistant", "Cascadia", "ComicShanns", "Excalifont", "Liberation", "Lilita", "Nunito", "Virgil"]
const fonts = path.join(work, "node_modules/@excalidraw/excalidraw/dist/prod/fonts")
await fs.mkdir(path.join(out, "fonts"), { recursive: true })
for (const family of families) {
  await fs.cp(path.join(fonts, family), path.join(out, "fonts", family), { recursive: true })
}
await Bun.write(path.join(out, "VERSION"), `${version}\n`)

if (process.argv.includes("--archive")) {
  const archive = path.join(root, "dist", `redcode-whiteboard-${version}.tar.gz`)
  await $`tar -czf ${archive} -C ${out} .`
  console.log(`wrote ${archive}`)
}
console.log(`built ${out}`)
