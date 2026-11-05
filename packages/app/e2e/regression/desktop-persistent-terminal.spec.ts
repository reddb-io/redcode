import { test, expect, _electron } from "@playwright/test"
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

// Opt in with REDCODE_DESKTOP_VALIDATION_BUILD pointing at a fresh `electron-vite build --outDir` directory.
// For an unpackaged build outside the repository, add a {"type":"module"} package.json and a node_modules junction
// to packages/desktop/node_modules at that directory. The test owns a separate profile and server.
test("isolated Electron opens and operates a persistent terminal", async () => {
  test.skip(
    process.platform !== "win32" || !process.env.REDCODE_DESKTOP_VALIDATION_BUILD,
    "Requires an isolated Windows Electron build",
  )
  test.setTimeout(90_000)
  const build = process.env.REDCODE_DESKTOP_VALIDATION_BUILD!
  const root = await mkdtemp(path.join(tmpdir(), "redcode-electron-e2e-"))
  const server = spawn("bun", [path.resolve("../server/test/fixture/persistent-browser-server.ts")], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  const lines = createInterface({ input: server.stdout })
  let logs = ""
  server.stderr.on("data", (chunk) => {
    logs += chunk.toString()
  })
  let electron: Awaited<ReturnType<typeof _electron.launch>> | undefined
  try {
    const base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`fixture timeout ${logs}`)), 30_000)
      server.once("exit", (code) => reject(new Error(`fixture exited ${code} ${logs}`)))
      lines.on("line", (line) => {
        if (line.startsWith("FIXTURE_READY ")) {
          clearTimeout(timer)
          resolve(line.slice(14))
        }
      })
    })
    const headers = {
      authorization: `Basic ${Buffer.from("opencode:test-only").toString("base64")}`,
      "content-type": "application/json",
    }
    const response = await fetch(`${base}/api/session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Electron terminal validation", location: { directory: process.cwd() } }),
    })
    expect(response.ok).toBe(true)
    const id = (await response.json()).data.id as string
    const created = await fetch(`${base}/api/experimental/session/${id}/terminal`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        command: process.env.ComSpec,
        args: ["/d", "/q", "/k", "echo DESKTOP_READY"],
        cwd: process.cwd(),
        title: "Desktop",
        env: {},
      }),
    })
    expect(created.ok).toBe(true)
    const ptyID = (await created.json()).data.id as string
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^(OPENCODE_|OTEL_|ELECTRON_)/.test(key)),
    ) as Record<string, string>
    electron = await _electron.launch({
      executablePath: path.resolve("../desktop/node_modules/electron/dist/electron.exe"),
      args: [path.join(build, "main", "index.js")],
      env: {
        ...env,
        REDCODE_DESKTOP_TEST_ROOT: root,
        REDCODE_DESKTOP_SERVER_URL: base,
        REDCODE_DESKTOP_SERVER_PASSWORD: "test-only",
        REDCODE_DESKTOP_DEBUG_PORT: "0",
      },
    })
    const page = await electron.firstWindow()
    await page.waitForURL(/oc:\/\/renderer\/index\.html/, { timeout: 30_000 })
    await page.waitForLoadState("domcontentloaded")
    await expect(page.getByRole("button", { name: "New session" }).first()).toBeVisible({ timeout: 30_000 })
    await page.getByText("Electron terminal validation", { exact: true }).last().click({ timeout: 30_000 })
    await expect(page.getByRole("heading", { name: "Electron terminal validation" })).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press("Control+Backquote")
    await expect(page.locator('[data-component="terminal"] textarea')).toHaveCount(1, { timeout: 30_000 })
    await page.locator('[data-component="terminal"]').click()
    await page.keyboard.type("echo ELDESK42")
    await page.keyboard.press("Enter")
    await expect
      .poll(
        async () =>
          (await (await fetch(`${base}/api/experimental/persistent-pty/${ptyID}/snapshot`, { headers })).json()).data
            .text as string,
      )
      .toContain("\nELDESK42")
  } finally {
    await electron?.close()
    server.stdin.end()
    await new Promise<void>((resolve) => (server.exitCode !== null ? resolve() : server.once("exit", () => resolve())))
    lines.close()
    await rm(root, { recursive: true, force: true })
  }
})
