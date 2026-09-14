import { describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { Effect } from "effect"
import { default as realOpen } from "open"
import { DesignBrowser } from "../../src/design/browser"

const url = "http://127.0.0.1:4096/design/session/ses_browser/review"

// Real processes, so exit and error observation is exercised without launching a browser.
const exits = (code: number) => spawn(process.execPath, ["-e", `process.exit(${code})`], { stdio: "ignore" })
const lingers = () => spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore" })

function fixture(
  input: {
    found?: string[]
    bundles?: string[]
    wsl?: boolean
    child?: (app: string | undefined) => ChildProcess | Promise<ChildProcess>
  } = {},
) {
  const calls: { target: string; app?: string }[] = []
  const children: ChildProcess[] = []
  const options = (platform: NodeJS.Platform, env: Record<string, string | undefined> = {}) => ({
    platform,
    env,
    grace: 300,
    home: "/Users/tester",
    wsl: () => input.wsl ?? false,
    exists: (file: string) => input.bundles?.includes(file) ?? false,
    which: (command: string) => (input.found?.includes(command) ? `/usr/bin/${command}` : null),
    load: async () => ({
      apps: { chrome: "chrome" },
      open: async (target: string, options?: { app: { name: string } }) => {
        calls.push({ target, app: options?.app.name })
        const child = await (input.child ?? (() => exits(0)))(options?.app.name)
        children.push(child)
        return child
      },
    }),
  })
  return { calls, children, options }
}

const run = (options: DesignBrowser.Options) => Effect.runPromise(DesignBrowser.open(url, options))

describe("DesignBrowser.open", () => {
  test("REDCODE_DESIGN_BROWSER=default uses the system browser", async () => {
    const browser = fixture({ found: ["google-chrome"] })
    expect(await run(browser.options("linux", { REDCODE_DESIGN_BROWSER: "default" }))).toBe(true)
    expect(browser.calls).toEqual([{ target: url, app: undefined }])
  })

  test("REDCODE_DESIGN_BROWSER with a name or path is passed as the app", async () => {
    const browser = fixture({ found: ["google-chrome"] })
    await run(browser.options("linux", { REDCODE_DESIGN_BROWSER: "/opt/brave/brave" }))
    expect(browser.calls).toEqual([{ target: url, app: "/opt/brave/brave" }])
  })

  test("a nonexistent browser with the real open does not crash and falls back", async () => {
    const defaults: string[] = []
    const opened = await run({
      platform: "linux",
      env: { REDCODE_DESIGN_BROWSER: "definitely-not-a-browser-xyz" },
      grace: 1000,
      load: async () => ({
        apps: { chrome: "chrome" },
        open: async (target: string, options?: { app: { name: string } }) => {
          if (options) return realOpen(target, options)
          defaults.push(target)
          return exits(0)
        },
      }),
    })
    // Give a late uncaught ENOENT a chance to surface and fail the run.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(opened).toBe(true)
    expect(defaults).toEqual([url])
  })

  test("Linux passes the first Chrome or Chromium path found on PATH", async () => {
    const browser = fixture({ found: ["chromium", "chromium-browser"] })
    await run(browser.options("linux"))
    expect(browser.calls).toEqual([{ target: url, app: "/usr/bin/chromium" }])
  })

  test("a browser that exits non-zero falls back to the next candidate, then the system browser", async () => {
    const browser = fixture({
      found: ["google-chrome", "chromium"],
      child: (app) => exits(app === undefined ? 0 : 1),
    })
    expect(await run(browser.options("linux"))).toBe(true)
    expect(browser.calls).toEqual([
      { target: url, app: "/usr/bin/google-chrome" },
      { target: url, app: "/usr/bin/chromium" },
      { target: url, app: undefined },
    ])
  })

  test("a browser still running after the grace window counts as opened", async () => {
    const browser = fixture({ found: ["google-chrome"], child: () => lingers() })
    expect(await run(browser.options("linux"))).toBe(true)
    expect(browser.calls).toEqual([{ target: url, app: "/usr/bin/google-chrome" }])
    browser.children.forEach((child) => child.kill())
  })

  test("WSL skips the Chrome search and opens the system browser", async () => {
    const browser = fixture({ found: ["google-chrome"], wsl: true })
    await run(browser.options("linux"))
    expect(browser.calls).toEqual([{ target: url, app: undefined }])
  })

  test("macOS opens Chrome only when its app bundle is installed", async () => {
    const installed = fixture({ bundles: ["/Users/tester/Applications/Google Chrome.app"] })
    await run(installed.options("darwin"))
    expect(installed.calls).toEqual([{ target: url, app: "google chrome" }])
    const missing = fixture()
    await run(missing.options("darwin"))
    expect(missing.calls).toEqual([{ target: url, app: undefined }])
  })

  test("Windows falls back when Chrome exits non-zero", async () => {
    const browser = fixture({ child: (app) => exits(app === undefined ? 0 : 1) })
    await run(browser.options("win32"))
    expect(browser.calls).toEqual([
      { target: url, app: "chrome" },
      { target: url, app: undefined },
    ])
  })

  test("a rejected launch falls back to the system browser", async () => {
    const browser = fixture({
      found: ["google-chrome"],
      child: (app) => (app === undefined ? exits(0) : Promise.reject(new Error("launch failed"))),
    })
    expect(await run(browser.options("linux"))).toBe(true)
    expect(browser.calls.map((call) => call.app)).toEqual(["/usr/bin/google-chrome", undefined])
  })

  test("never throws when every launch fails or open cannot load", async () => {
    const browser = fixture({ found: ["google-chrome"], child: () => exits(2) })
    await expect(run(browser.options("linux"))).resolves.toBe(false)
    expect(browser.calls).toHaveLength(2)
    await expect(
      run({
        platform: "linux",
        env: {},
        load: async () => {
          throw new Error("missing open")
        },
      }),
    ).resolves.toBe(false)
  })
})
