import { describe, expect, test } from "bun:test"
import { dict } from "../../i18n/en"
import { mcpBrowserOpenFailedToast, readMcpBrowserOpenFailed } from "./mcp-browser-open-failed"

const url = "https://auth.example.com/authorize?client_id=redcode&state=abc"

const t = (key: keyof typeof dict, params?: Record<string, string>) =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, value), dict[key])

describe("mcp.browser.open.failed", () => {
  test("reads the authorization URL from the server event", () => {
    expect(
      readMcpBrowserOpenFailed({ type: "mcp.browser.open.failed", properties: { mcpName: "linear", url } }),
    ).toEqual({ mcpName: "linear", url })
    expect(readMcpBrowserOpenFailed({ type: "mcp.status.changed", properties: { mcpName: "linear", url } })).toBe(
      undefined,
    )
    expect(readMcpBrowserOpenFailed({ type: "mcp.browser.open.failed", properties: { mcpName: "linear" } })).toBe(
      undefined,
    )
  })

  test("ignores URLs that are not web authorization pages", () => {
    for (const value of ["javascript:alert(1)", "file:///etc/passwd", "vscode://x", "not a url"])
      expect(
        readMcpBrowserOpenFailed({ type: "mcp.browser.open.failed", properties: { mcpName: "linear", url: value } }),
      ).toBe(undefined)
  })

  test("shows the URL in a persistent toast with open and copy actions", () => {
    const opened: string[] = []
    const copied: string[] = []
    const event = readMcpBrowserOpenFailed({ type: "mcp.browser.open.failed", properties: { mcpName: "linear", url } })
    const toast = mcpBrowserOpenFailedToast(event!, {
      t,
      openExternal: (value) => opened.push(value),
      copy: (value) => copied.push(value),
    })

    expect(toast.persistent).toBe(true)
    expect(toast.title).toBe("Authorize linear")
    expect(toast.description).toContain(url)
    expect(toast.actions?.map((action) => action.label)).toEqual(["Open URL", "Copy URL", "Dismiss"])

    const [open, copy, dismiss] = toast.actions!
    if (typeof open.onClick === "function") open.onClick()
    if (typeof copy.onClick === "function") copy.onClick()
    expect(opened).toEqual([url])
    expect(copied).toEqual([url])
    expect(dismiss.onClick).toBe("dismiss")
  })
})
