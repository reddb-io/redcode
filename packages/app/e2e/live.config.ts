import { defineConfig, devices } from "@playwright/test"
import { fileURLToPath } from "node:url"

const port = Number(process.env.REDCODE_E2E_PORT ?? 4779)
const baseURL = `http://127.0.0.1:${port}`
process.env.REDCODE_E2E_LIVE = "1"
process.env.PLAYWRIGHT_SERVER_HOST = "127.0.0.1"
process.env.PLAYWRIGHT_SERVER_PORT = String(port)

export default defineConfig({
  testDir: "./regression",
  testMatch: "**/home.spec.ts",
  grep: /live server:/,
  outputDir: "./test-results/live",
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [["line"]],
  use: { baseURL, serviceWorkers: "block", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    command: `bun ../server/test/fixture/browser-server.ts --port ${port} --dist dist`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
