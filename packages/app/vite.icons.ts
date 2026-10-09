import { readFileSync } from "node:fs"
import type { Plugin } from "vite"
import manifest from "./manifest.json" with { type: "json" }
import platform from "../design-system/platform/platform-manifest.json" with { type: "json" }

// Every channel serves the RedDB platform icons the design system publishes, byte-for-byte, at the paths its
// platform manifest links (scripts/sync-design-system.ts vendors them).
export function icons(): Plugin {
  const files = [
    ...platform.icons.map((icon) => ({
      fileName: icon.file,
      source: readFileSync(new URL(`../design-system/platform/${icon.file}`, import.meta.url)),
      type: icon.file.endsWith(".svg") ? "image/svg+xml" : icon.file.endsWith(".ico") ? "image/x-icon" : "image/png",
    })),
    {
      fileName: "site.webmanifest",
      source: JSON.stringify({ ...manifest, icons: platform.manifestIcons }),
      type: "application/manifest+json",
    },
  ]

  return {
    name: "opencode-app:icons",
    generateBundle() {
      files.forEach((file) => this.emitFile({ type: "asset", fileName: file.fileName, source: file.source }))
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = files.find((file) => `/${file.fileName}` === request.url?.split("?")[0])

        if (!file) return next()
        response.setHeader("Content-Type", file.type)
        response.end(file.source)
      })
    },
  }
}
