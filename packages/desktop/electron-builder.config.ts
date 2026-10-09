import type { Configuration } from "electron-builder"
import redcode from "../redcode/package.json" with { type: "json" }

const channel = (() => {
  const raw = process.env.REDCODE_DESKTOP_CHANNEL

  if (raw === "dev" || raw === "beta" || raw === "prod") return raw

  return "dev"
})()

const APP_IDS = {
  dev: "io.reddb.redcode.dev",
  beta: "io.reddb.redcode.beta",
  prod: "io.reddb.redcode",
} as const

const PRODUCT_NAMES = {
  dev: "Redcode Dev",
  beta: "Redcode Beta",
  prod: "Redcode",
} as const

// The desktop ships unpacked (`electron-builder --dir`) inside the Redcode release, beside the redcode binary it runs,
// so there are no installers, update feeds or bundled CLI here. `redcode desktop` prepares and opens it, and the app
// registers its own launcher and protocol on first launch (src/main/lifecycle/shell-integration.ts).
function getConfig(): Configuration {
  const appId = APP_IDS[channel]
  const productName = PRODUCT_NAMES[channel]

  return {
    appId,
    productName,
    directories: {
      output: "dist",
      buildResources: "resources",
    },
    // Linux launchers are .desktop files, so this is the desktop file name, not just the app id.
    // https://www.electron.build/docs/linux/
    // The desktop ships in the same release as the CLI and the design app, so it carries the Redcode version.
    extraMetadata: {
      desktopName: `${appId}.desktop`,
      version: process.env.REDCODE_VERSION ?? redcode.version,
    },
    files: [
      "out/**/*",
      // Renderer source maps stay in out/ for local debugging; nothing uploads or reads them at runtime.
      "!out/**/*.map",
      "resources/**/*",
      // Log export imports Zip.js as ESM. Keep index.js and lib, including its inline worker.
      "!**/node_modules/@zip.js/zip.js/dist{,/**/*}",
      "!**/node_modules/@zip.js/zip.js/{index.cjs,index.min.js,index-fflate.js,deno.json,eslint.config.mjs}",
      // Nothing executes type declarations or source maps, and every entry costs startup time: the
      // main process parses the whole asar header before it runs any JavaScript.
      "!**/node_modules/**/*.d.{ts,cts,mts}",
      "!**/node_modules/**/*.d.{ts,cts,mts}.map",
      "!**/node_modules/**/*.{js,cjs,mjs}.map",
      // These packages execute compiled JavaScript, not their sources.
      "!**/node_modules/ajv/lib{,/**/*}",
      "!**/node_modules/ajv-formats/src{,/**/*}",
      // Keep js-yaml's CommonJS sources and dist/js-yaml.mjs ESM entry, not browser bundles or its CLI.
      "!**/node_modules/js-yaml/dist/{js-yaml.js,js-yaml.min.js,*.map}",
      "!**/node_modules/js-yaml/bin{,/**/*}",
    ],
    // The app icon is the RedDB platform icon the design system publishes (scripts/sync-design-system.ts). The Linux
    // launcher the app writes on first launch takes its icon from here too.
    extraResources: [{ from: "../design-system/platform", to: "icons", filter: ["icon-512.png"] }],
    mac: {
      category: "public.app-category.developer-tools",
      icon: "../design-system/platform/icon-512.png",
      extendInfo: {
        NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac: true,
      },
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: "resources/entitlements.plist",
      entitlementsInherit: "resources/entitlements.plist",
      // Releases are not signed yet, so macOS builds are ad-hoc and cannot notarize.
      notarize: false,
      target: "dir",
    },
    protocols: {
      name: productName,
      schemes: ["redcode"],
    },
    win: {
      icon: "../design-system/platform/icon-512.png",
      target: "dir",
    },
    linux: {
      icon: "../design-system/platform/icon-512.png",
      category: "Development",
      // The launcher the app writes names this executable, and its StartupWMClass matches the app id too.
      executableName: appId,
      target: "dir",
    },
  }
}

export default getConfig()
