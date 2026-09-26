export * as DesignVendor from "./vendor.js"

// Pre-0.22 prototypes referenced these assets before revisions bundled dependencies locally.
import tailwind from "./vendor/legacy/tailwind.js.txt"
import daisyui from "./vendor/legacy/daisyui.css.txt"
import daisyuiThemes from "./vendor/legacy/daisyui-themes.css.txt"
import mermaid from "./vendor/legacy/mermaid.js.txt"

export const FILES: Record<string, { readonly mime: string; readonly body: string }> = {
  "tailwind.js": { mime: "text/javascript; charset=utf-8", body: tailwind },
  "daisyui.css": { mime: "text/css; charset=utf-8", body: daisyui },
  "daisyui-themes.css": { mime: "text/css; charset=utf-8", body: daisyuiThemes },
  "mermaid.js": { mime: "text/javascript; charset=utf-8", body: mermaid },
}
