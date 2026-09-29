import { describe, expect, test } from "bun:test"
import {
  BrowserDisabledError,
  browserDisabled,
  designBrowser,
  designLaunch,
  openDesignUrl,
  openPath,
  openUrl,
} from "./open.js"

describe("openUrl", () => {
  test("rejects values that are not URLs", async () => {
    await expect(openUrl("not a url")).rejects.toThrow("Only http and https links")
    await expect(openUrl("")).rejects.toThrow("Only http and https links")
  })

  test("rejects non-http schemes", async () => {
    await expect(openUrl("file:///etc/hosts")).rejects.toThrow("Only http and https links")
    await expect(openUrl("javascript:alert(1)")).rejects.toThrow("Only http and https links")
    await expect(openUrl("ms-msdt:/id PCWDiagnostic")).rejects.toThrow("Only http and https links")
    await expect(openUrl("\\\\server\\share\\file.html")).rejects.toThrow("Only http and https links")
  })

  test("REDCODE_NO_BROWSER refuses the launch and reports the link", async () => {
    const env = { REDCODE_NO_BROWSER: "1" }
    const error = await openUrl("https://example.com/review?ticket=a", { env, browser: "chromium" }).then(
      () => undefined,
      (cause: unknown) => cause,
    )
    expect(error).toBeInstanceOf(BrowserDisabledError)
    expect(error instanceof BrowserDisabledError && error.target).toBe("https://example.com/review?ticket=a")
    expect(error instanceof Error && error.message).toContain("https://example.com/review?ticket=a")
    await expect(openPath("/tmp/redcode.log", { env })).rejects.toBeInstanceOf(BrowserDisabledError)
    await expect(openDesignUrl("https://example.com/review", { env, configured: "app" })).rejects.toBeInstanceOf(
      BrowserDisabledError,
    )
    await expect(openDesignUrl("file:///etc/hosts", { env })).rejects.toThrow("Only http and https links")
  })
})

describe("browserDisabled", () => {
  test("treats unset and explicit false values as enabled", () => {
    expect(browserDisabled({})).toBe(false)
    expect(browserDisabled({ REDCODE_NO_BROWSER: "" })).toBe(false)
    expect(browserDisabled({ REDCODE_NO_BROWSER: "0" })).toBe(false)
    expect(browserDisabled({ REDCODE_NO_BROWSER: " False " })).toBe(false)
    expect(browserDisabled({ REDCODE_NO_BROWSER: "off" })).toBe(false)
  })

  test("treats other values as disabled", () => {
    expect(browserDisabled({ REDCODE_NO_BROWSER: "1" })).toBe(true)
    expect(browserDisabled({ REDCODE_NO_BROWSER: "true" })).toBe(true)
    expect(browserDisabled({ REDCODE_NO_BROWSER: "yes" })).toBe(true)
  })
})

describe("designBrowser", () => {
  test("prefers REDCODE_DESIGN_BROWSER over design.browser", () => {
    expect(designBrowser("firefox", { REDCODE_DESIGN_BROWSER: "chromium" })).toBe("chromium")
    expect(designBrowser(" firefox ", {})).toBe("firefox")
    expect(designBrowser(null, { REDCODE_DESIGN_BROWSER: " " })).toBeUndefined()
    expect(designBrowser(undefined, {})).toBeUndefined()
  })
})

describe("designLaunch", () => {
  const url = "http://127.0.0.1:4096/design/session/ses_a/review?ticket=signed"
  /** A machine whose only files are `files`; nothing is launched or probed beyond them. */
  const machine = (platform: NodeJS.Platform, files: string[], env: Record<string, string | undefined> = {}) => ({
    platform,
    env: { PATH: "/usr/local/bin:/usr/bin", ...env },
    home: "/home/me",
    exists: (file: string) => files.includes(file),
  })

  test("prefers an installed Chrome, then Chromium, else the system browser", () => {
    expect(designLaunch(url, undefined, machine("linux", ["/usr/bin/chromium", "/usr/bin/google-chrome-stable"]))).toEqual({
      kind: "tab",
      app: "/usr/bin/google-chrome-stable",
    })
    expect(designLaunch(url, undefined, machine("linux", ["/usr/bin/chromium-browser"]))).toEqual({
      kind: "tab",
      app: "/usr/bin/chromium-browser",
    })
    expect(designLaunch(url, undefined, machine("linux", []))).toEqual({ kind: "system" })
  })

  test("follows PATH order for the same browser name", () => {
    expect(
      designLaunch(url, undefined, machine("linux", ["/usr/bin/google-chrome", "/usr/local/bin/google-chrome"])),
    ).toEqual({ kind: "tab", app: "/usr/local/bin/google-chrome" })
  })

  test("chrome and chromium pick that family only", () => {
    const linux = machine("linux", ["/usr/bin/google-chrome", "/usr/bin/chromium"])
    expect(designLaunch(url, "Chromium", linux)).toEqual({ kind: "tab", app: "/usr/bin/chromium" })
    expect(designLaunch(url, "chrome", linux)).toEqual({ kind: "tab", app: "/usr/bin/google-chrome" })
    expect(designLaunch(url, "chrome", machine("linux", ["/usr/bin/chromium"]))).toEqual({ kind: "system" })
  })

  test("app opens a Chromium app window with the review URL as its only argument", () => {
    expect(designLaunch(url, "app", machine("linux", ["/usr/bin/chromium"]))).toEqual({
      kind: "window",
      app: "/usr/bin/chromium",
      arguments: [`--app=${url}`],
      newInstance: false,
    })
    expect(designLaunch(url, "app", machine("darwin", ["/home/me/Applications/Google Chrome.app"]))).toEqual({
      kind: "window",
      app: "google chrome",
      arguments: [`--app=${url}`],
      newInstance: true,
    })
    expect(designLaunch(url, "app", machine("linux", []))).toEqual({ kind: "system" })
  })

  test("finds macOS bundles and Windows installs by path", () => {
    expect(designLaunch(url, undefined, machine("darwin", ["/Applications/Chromium.app"]))).toEqual({
      kind: "tab",
      app: "chromium",
    })
    const chrome = "C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"
    expect(
      designLaunch(
        url,
        undefined,
        machine("win32", [chrome], { ProgramFiles: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }),
      ),
    ).toEqual({ kind: "tab", app: chrome })
  })

  test("default, WSL and named apps keep their own browser", () => {
    const linux = machine("linux", ["/usr/bin/google-chrome"])
    expect(designLaunch(url, "default", linux)).toEqual({ kind: "system" })
    expect(designLaunch(url, "firefox", linux)).toEqual({ kind: "tab", app: "firefox" })
    expect(designLaunch(url, "/opt/brave/brave", linux)).toEqual({ kind: "tab", app: "/opt/brave/brave" })
    expect(
      designLaunch(url, undefined, machine("linux", ["/usr/bin/google-chrome"], { WSL_DISTRO_NAME: "Ubuntu" })),
    ).toEqual({ kind: "system" })
  })
})
