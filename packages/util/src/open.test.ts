import { describe, expect, test } from "bun:test"
import { BrowserDisabledError, browserDisabled, designBrowser, openPath, openUrl } from "./open.js"

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
