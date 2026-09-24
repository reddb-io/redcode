export * as DesignVendor from "./vendor"

/**
 * The design assets a pre-0.22 prototype used without a network: Tailwind's browser runtime and
 * DaisyUI, plus Mermaid for diagrams. Importing such a prototype copies the ones it references into
 * it. Several megabytes, so only the design app links them; redcode asks the app for them.
 */

// Named .txt so they are text to both the bundler and the typechecker, never modules.
import tailwind from "../vendor/legacy/tailwind.js.txt"
import daisyui from "../vendor/legacy/daisyui.css.txt"
import daisyuiThemes from "../vendor/legacy/daisyui-themes.css.txt"
import mermaid from "../vendor/legacy/mermaid.js.txt"

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
