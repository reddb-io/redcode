import { stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { Configuration } from "electron-builder"

const packageDir = path.dirname(fileURLToPath(import.meta.url))

const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

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

const PACKAGE_NAMES = {
  dev: "redcode-desktop-dev",
  beta: "redcode-desktop-beta",
  prod: "redcode-desktop",
} as const

// Desktop releases live beside the CLI releases in the same repository, so updates are read from a rolling
// release instead of GitHub's "latest", which always points at the CLI.
const updateFeed = "https://github.com/reddb-io/redcode/releases/download/desktop-latest"

function getConfig(): Configuration {
  const appId = APP_IDS[channel]
  const productName = PRODUCT_NAMES[channel]

  return {
    appId,
    productName,
    artifactName: "redcode-desktop-${os}-${arch}.${ext}",
    directories: {
      output: "dist",
      buildResources: "resources",
    },
    // Linux launchers are .desktop files, so this is the desktop file name, not just the app id.
    // https://www.electron.build/docs/linux/
    extraMetadata: {
      desktopName: `${appId}.desktop`,
    },
    files: [
      "out/**/*",
      // Renderer source maps stay in out/ for local debugging; nothing uploads or reads them at runtime.
      "!out/**/*.map",
      "resources/**/*",
      "!resources/redcode*",
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
    // The Redcode binary runs as a background service, so it ships beside the app rather than inside the asar.
    // The app icon is the RedDB platform icon the design system publishes (scripts/sync-design-system.ts).
    extraResources: [
      { from: "../ui/vendor/design-system/platform", to: "icons", filter: ["icon-512.png"] },
      { from: "resources/", to: "", filter: ["redcode", "redcode.exe", "redcode.version"] },
    ],
    afterPack: async (context) => {
      const cli = path.join(
        context.packager.getResourcesDir(context.appOutDir),
        context.electronPlatformName === "win32" ? "redcode.exe" : "redcode",
      )

      const file = await stat(cli)

      if (!file.isFile() || file.size === 0) throw new Error(`Bundled CLI must be a non-empty file: ${cli}`)
      const version = path.join(path.dirname(cli), "redcode.version")

      if ((await stat(version)).size === 0) throw new Error(`Bundled CLI version must be a non-empty file: ${version}`)
    },
    publish: channel === "prod" ? [{ provider: "generic", url: updateFeed }] : undefined,
    mac: {
      category: "public.app-category.developer-tools",
      icon: "../ui/vendor/design-system/platform/icon-512.png",
      extendInfo: {
        NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac: true,
      },
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: "resources/entitlements.plist",
      entitlementsInherit: "resources/entitlements.plist",
      // Releases are not signed yet, so macOS builds are ad-hoc and cannot notarize.
      notarize: false,
      target: ["dmg", "zip"],
    },
    protocols: {
      name: productName,
      schemes: ["redcode"],
    },
    win: {
      icon: "../ui/vendor/design-system/platform/icon-512.png",
      target: ["nsis"],
      verifyUpdateCodeSignature: false,
    },
    nsis: {
      include: path.join(packageDir, "resources", "windows", "installer.nsh"),
      oneClick: true,
      perMachine: false,
    },
    linux: {
      icon: "../ui/vendor/design-system/platform/icon-512.png",
      category: "Development",
      executableName: appId,
      desktop: {
        entry: {
          // Match the installed .desktop file and hicolor icon basename so
          // Linux shells can associate the running Electron window with its launcher.
          StartupWMClass: appId,
        },
      },
      target: ["AppImage", "deb", "rpm"],
    },
    deb: { fpm: [metainfoFpm(appId)] },
    rpm: { packageName: PACKAGE_NAMES[channel], fpm: [metainfoFpm(appId)] },
  }
}

export default getConfig()
