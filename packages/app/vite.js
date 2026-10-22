import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import solidPlugin from "vite-plugin-solid"
import reactPlugin from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"

const theme = fileURLToPath(new URL("./public/oc-theme-preload.js", import.meta.url))

const themeScript = readFileSync(theme, "utf8")

const tailwind = tailwindcss()
const reactSources = [/\.react\.tsx$/]

const tailwindGenerate = tailwind.find((plugin) => plugin.name === "@tailwindcss/vite:generate:serve")

const tailwindHotUpdate = tailwindGenerate?.hotUpdate

// Tailwind 4.3.3 expects a server that Vite's bundled dev hook does not provide.
if (tailwindGenerate && typeof tailwindHotUpdate === "function") {
  tailwindGenerate.hotUpdate = function (context) {
    if (!context.server) return

    return tailwindHotUpdate.call(this, context)
  }
}

// The markdown worker imports these directly, so they are served unbundled to keep worker startup
// stable. Vite applies `exclude` to every import inside a pre-bundle too, which would leave a bare
// `import "marked"` in mermaid's chunk that the browser cannot resolve from this package.
const workerDeps = ["@shikijs/stream", "marked", "marked-shiki", "remend"]

// The Office previews load their wasm and fonts through `new URL(..., import.meta.url)`, which a pre-bundle would move
// away from the files.
const officeDeps = ["@betteroffice/docx", "@betteroffice/fonts", "@betteroffice/pptx", "@betteroffice/xlsx"]

// The build emits the Office engines' wasm and worker files for every `new URL(..., import.meta.url)` it sees, even in
// code that tree shaking drops. A file that no other emitted file names never loads, so it is left out of the build.
const officeEmitted = /^(?:docx_\w+_bg|ooxml_opc_bg|pptx_wasm_bg|xlsx_wasm_bg|residentEngineWorker)\b/

/** @type {import("vite").Plugin} */
const dropUnloadedOfficeFiles = {
  name: "opencode-desktop:drop-unloaded-office-files",
  apply: "build",
  generateBundle: {
    order: "post",
    handler(_, bundle) {
      const files = Object.values(bundle).filter((file) => !file.fileName.endsWith(".map"))
      const name = (file) => file.fileName.split("/").pop() ?? file.fileName
      const source = (file) => (file.type === "chunk" ? file.code : typeof file.source === "string" ? file.source : "")
      const named = (file) => files.some((other) => other !== file && source(other).includes(name(file)))

      files
        .filter((file) => officeEmitted.test(name(file)) && !named(file))
        .forEach((file) => {
          delete bundle[file.fileName]
          delete bundle[`${file.fileName}.map`]
        })
    },
  },
}

/** @type {import("rolldown").Plugin} */
const bundleNestedWorkerDeps = {
  name: "opencode-desktop:bundle-nested-worker-deps",
  resolveId(id, importer) {
    if (!importer || !workerDeps.includes(id) || !importer.includes("node_modules")) return

    try {
      return createRequire(importer).resolve(id)
    } catch {
      return
    }
  },
}

export const channel = (() => {
  // The desktop renderer builds through this plugin too, and names its channel with REDCODE_DESKTOP_CHANNEL.
  const raw = process.env.OPENCODE_CHANNEL ?? process.env.REDCODE_DESKTOP_CHANNEL

  if (raw === "local" || raw === "dev" || raw === "beta" || raw === "prod") return raw

  if (process.env.OPENCODE_CHANNEL === "latest") return "prod"

  return "dev"
})()

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "opencode-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
            // The font package imports its 33 MB Chinese, Japanese and Korean add-on on demand; the app does not ship it.
            "@betteroffice/fonts-cjk": fileURLToPath(
              new URL("../gui-extensions/src/microsoft-office/fonts-cjk.ts", import.meta.url),
            ),
            // Use the browser build: its `solid` export contains JSX in .js files and cannot be pre-bundled.
            "@kitlangton/solid-motion": fileURLToPath(
              new URL("../ui/node_modules/@kitlangton/solid-motion/dist/index.js", import.meta.url),
            ),
          },
        },
        define: {
          "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify(channel),
        },
        worker: {
          format: "es",
        },
        optimizeDeps: {
          exclude: [...workerDeps, ...officeDeps],
          include: [
            "@opencode/session-ui > mermaid",
            "@opencode/session-ui > mermaid > katex",
            ...[
              "Badge",
              "Button",
              "Checkbox",
              "Dialog",
              "Disclosure",
              "DropdownMenu",
              "Input",
              "Logo",
              "Select",
              "SearchSelect",
              "Switch",
              "Tabs",
              "Textarea",
              "Tooltip",
            ].map((name) => `@reddb-io/design-system/base/${name}`),
          ],
          rolldownOptions: { plugins: [bundleNestedWorkerDeps] },
        },
      }
    },
  },
  {
    name: "redcode:portable-ds-recipes",
    enforce: "pre",
    resolveId(id, importer) {
      if (
        id !== "@reddb-io/design-system/base" ||
        !importer?.replaceAll("\\", "/").includes("/design-system/client/kits/app/src/")
      )
        return
      return this.resolve("@reddb-io/design-system/contracts/base", importer, { skipSelf: true })
    },
  },
  dropUnloadedOfficeFiles,
  {
    name: "opencode-desktop:theme-preload",
    transformIndexHtml: {
      order: "pre",
      handler: inlineThemePreload,
    },
  },
  ...tailwind,
  reactPlugin({ include: reactSources }),
  solidPlugin({ exclude: reactSources }),
]

export function inlineThemePreload(html) {
  return html.replace(
    /<script id="oc-theme-preload-script" src="(?:\.\/|\/)oc-theme-preload\.js"><\/script>/,
    `<script id="oc-theme-preload-script">${themeScript}</script>`,
  )
}
