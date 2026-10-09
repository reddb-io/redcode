import type { Configuration } from "electron-builder"

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

const appId = APP_IDS[channel]

// Desktop releases live beside the CLI releases in the same repository, so updates are read from a rolling
// release instead of GitHub's "latest", which always points at the CLI.
const updateFeed = "https://github.com/reddb-io/redcode/releases/download/desktop-latest"

const config: Configuration = {
  appId,
  productName: PRODUCT_NAMES[channel],
  artifactName: "redcode-desktop-${os}-${arch}.${ext}",
  directories: { output: "dist", buildResources: "resources" },
  extraMetadata: { desktopName: `${appId}.desktop` },
  files: ["out/**/*", "!out/**/*.map"],
  // The Redcode binary runs as a background service, so it ships beside the app rather than inside the asar.
  extraResources: [
    { from: "resources/icons", to: "icons" },
    { from: "resources/bin", to: ".", filter: ["redcode*"] },
  ],
  publish: channel === "prod" ? [{ provider: "generic", url: updateFeed }] : undefined,
  mac: {
    category: "public.app-category.developer-tools",
    icon: "resources/icons/icon.png",
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    // Releases are not signed yet, so macOS builds are ad-hoc and cannot notarize.
    notarize: false,
    target: ["dmg", "zip"],
  },
  win: { icon: "resources/icons/icon.png", target: ["nsis"], verifyUpdateCodeSignature: false },
  nsis: { oneClick: true, perMachine: false },
  linux: {
    icon: "resources/icons/icon.png",
    category: "Development",
    executableName: appId,
    desktop: { entry: { StartupWMClass: appId } },
    target: ["AppImage", "deb", "rpm"],
  },
}

export default config
