import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { DesignBrowser } from "../../src/design/browser"

const url = "http://127.0.0.1:4096/design/session/ses_browser/review"

function fixture(input: { found?: string[]; reject?: (app: unknown) => boolean } = {}) {
  const calls: { target: string; app?: unknown }[] = []
  const lookups: string[] = []
  const options = (platform: NodeJS.Platform, env: Record<string, string | undefined> = {}) => ({
    platform,
    env,
    which: (command: string) => {
      lookups.push(command)
      return input.found?.includes(command) ? `/usr/bin/${command}` : null
    },
    load: async () => ({
      apps: { chrome: platform === "darwin" ? "google chrome" : "chrome" },
      open: async (target: string, options?: { app: { name: string | readonly string[] } }) => {
        calls.push({ target, app: options?.app.name })
        if (input.reject?.(options?.app.name)) throw new Error("launch failed")
      },
    }),
  })
  return { calls, lookups, options }
}

const run = (options: DesignBrowser.Options) => Effect.runPromise(DesignBrowser.open(url, options))

describe("DesignBrowser.open", () => {
  test("REDCODE_DESIGN_BROWSER=default uses the system browser", async () => {
    const browser = fixture({ found: ["google-chrome"] })
    await run(browser.options("linux", { REDCODE_DESIGN_BROWSER: "default" }))
    expect(browser.calls).toEqual([{ target: url, app: undefined }])
  })

  test("REDCODE_DESIGN_BROWSER with a name or path is passed as the app", async () => {
    const browser = fixture({ found: ["google-chrome"] })
    await run(browser.options("linux", { REDCODE_DESIGN_BROWSER: "/opt/brave/brave" }))
    expect(browser.calls).toEqual([{ target: url, app: "/opt/brave/brave" }])
  })

  test("Linux picks the first Chrome or Chromium found on PATH", async () => {
    const browser = fixture({ found: ["chromium", "chromium-browser"] })
    await run(browser.options("linux"))
    expect(browser.calls).toEqual([{ target: url, app: "chromium" }])
    expect(browser.lookups.slice(0, 5)).toEqual([
      "google-chrome",
      "google-chrome-stable",
      "google-chrome-beta",
      "google-chrome-unstable",
      "chromium",
    ])
  })

  test("macOS and Windows use the detected Chrome app", async () => {
    const mac = fixture()
    await run(mac.options("darwin"))
    expect(mac.calls).toEqual([{ target: url, app: ["google chrome", "chromium"] }])
    const windows = fixture()
    await run(windows.options("win32"))
    expect(windows.calls).toEqual([{ target: url, app: "chrome" }])
  })

  test("no Chrome or Chromium falls back to the system browser", async () => {
    const browser = fixture()
    await run(browser.options("linux"))
    expect(browser.calls).toEqual([{ target: url, app: undefined }])
  })

  test("a failed Chrome launch falls back to the system browser", async () => {
    const browser = fixture({ found: ["google-chrome"], reject: (app) => app !== undefined })
    await run(browser.options("linux"))
    expect(browser.calls).toEqual([
      { target: url, app: "google-chrome" },
      { target: url, app: undefined },
    ])
  })

  test("reports an opened browser", async () => {
    const browser = fixture({ found: ["google-chrome"] })
    expect(await run(browser.options("linux"))).toBe(true)
  })

  test("never throws when every launch fails or open cannot load", async () => {
    const browser = fixture({ found: ["google-chrome"], reject: () => true })
    await expect(run(browser.options("linux"))).resolves.toBe(false)
    expect(browser.calls).toHaveLength(2)
    await expect(
      run({
        platform: "linux",
        env: {},
        which: () => {
          throw new Error("which failed")
        },
        load: async () => {
          throw new Error("missing open")
        },
      }),
    ).resolves.toBe(false)
  })
})
