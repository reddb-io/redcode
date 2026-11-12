import path from "node:path"
import os from "node:os"
import { build } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const output = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "redcode-json-lens", "build"))
await build({
  root: import.meta.dir,
  configFile: false,
  plugins: [react(), tailwindcss()],
  build: { outDir: output, emptyOutDir: false, assetsInlineLimit: 2_000_000, cssCodeSplit: false, sourcemap: false },
})
const html = await Bun.file(path.join(output, "index.html")).text()
const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)]
const styles = [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)]
let portable = html
for (const match of scripts) {
  const js = await Bun.file(path.join(output, match[1].replace(/^\//, ""))).text()
  portable = portable.replace(
    match[0],
    () => `<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>`,
  )
}
for (const match of styles) {
  const css = await Bun.file(path.join(output, match[1].replace(/^\//, ""))).text()
  portable = portable.replace(match[0], () => `<style>${css}</style>`)
}
await Bun.write(path.join(output, "component.html"), portable)
console.log(`Portable Creator component: ${path.join(output, "component.html")} (${Buffer.byteLength(portable)} bytes)`)
