import { defineConfig } from "electron-vite"
import appPlugin from "@opencode/app/vite"

const channel = (() => {
  const raw = process.env.REDCODE_DESKTOP_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

export default defineConfig({
  main: {
    define: {
      "import.meta.env.REDCODE_DESKTOP_CHANNEL": JSON.stringify(channel),
    },
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts" },
        output: { format: "es" },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: { format: "cjs", entryFileNames: "[name].js" },
      },
    },
  },
  renderer: {
    // The app plugin is typed against the Vite version the app builds with, which differs from electron-vite's.
    plugins: [appPlugin as never],
    publicDir: "../../../app/public",
    root: "src/renderer",
    build: {
      rollupOptions: {
        input: { main: "src/renderer/index.html" },
      },
    },
  },
})
