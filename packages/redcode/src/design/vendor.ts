/**
 * The design assets a prototype may use without a network.
 *
 * lavish's third choice, when neither the user nor the project names a look: Tailwind's browser
 * runtime and DaisyUI, plus Mermaid for diagrams. Shipped inside the binary and served under
 * `/design/vendor/<file>`, which from a prototype at `/design/<id>/files/` is `../../vendor/`.
 * Public and cacheable: they are not the prototype and disclose nothing.
 */

// Named .txt so they are text to both the bundler and the typechecker, never modules.
import tailwind from "./vendor/tailwind.js.txt"
import daisyui from "./vendor/daisyui.css.txt"
import daisyuiThemes from "./vendor/daisyui-themes.css.txt"
import mermaid from "./vendor/mermaid.js.txt"

export interface Asset {
  readonly mime: string
  readonly body: string
}

export const FILES: Record<string, Asset> = {
  "tailwind.js": { mime: "text/javascript; charset=utf-8", body: tailwind },
  "daisyui.css": { mime: "text/css; charset=utf-8", body: daisyui },
  "daisyui-themes.css": { mime: "text/css; charset=utf-8", body: daisyuiThemes },
  "mermaid.js": { mime: "text/javascript; charset=utf-8", body: mermaid },
}

/** What a prototype writes to use them, relative to its own index.html. */
export const SNIPPET = [
  '<link rel="stylesheet" href="../../vendor/daisyui.css">',
  '<link rel="stylesheet" href="../../vendor/daisyui-themes.css">',
  '<script src="../../vendor/tailwind.js"></script>',
].join("\n")

export const MERMAID_SNIPPET = `<script src="../../vendor/mermaid.js"></script>
<script>
  // Render Mermaid in the theme the page is actually painted in, and again when it flips.
  const paint = document.createElement("canvas").getContext("2d")
  const rgba = (color) => { paint.clearRect(0,0,1,1); paint.fillStyle = "#000"; paint.fillStyle = color; paint.fillRect(0,0,1,1); return paint.getImageData(0,0,1,1).data }
  const dark = () => { const [r,g,b,a] = rgba(getComputedStyle(document.body).backgroundColor); return a > 0 ? (0.2126*r + 0.7152*g + 0.0722*b)/255 < 0.5 : matchMedia("(prefers-color-scheme: dark)").matches }
  const render = () => {
    for (const el of document.querySelectorAll(".mermaid")) { if (!el.dataset.src) el.dataset.src = el.textContent; el.removeAttribute("data-processed"); el.textContent = el.dataset.src }
    mermaid.initialize({ startOnLoad: false, theme: dark() ? "dark" : "default", securityLevel: "strict" })
    mermaid.run({ querySelector: ".mermaid" })
  }
  render()
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] })
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render)
</script>`

/** Opt-in, never injected: the CSS that keeps a layout from breaking at a narrow width. */
export const LAYOUT_SAFETY_CSS = `<style>
  *, *::before, *::after { box-sizing: border-box }
  :where(.grid, .flex, [style*="display:grid"], [style*="display:flex"]) > * { min-width: 0 }
  :where(p, li, td, th, dd, dt, h1, h2, h3, h4, h5, h6, .badge, .label) { overflow-wrap: anywhere }
  :where(img, video, svg, canvas) { max-width: 100%; height: auto }
</style>`

export * as DesignVendor from "./vendor"
