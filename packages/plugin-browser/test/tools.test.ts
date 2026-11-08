import { expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { basename, dirname } from "node:path"
import { Effect } from "effect"
import { Browser } from "../src/rpc.js"
import { BrowserFiles } from "../src/files.js"
import { BrowserTools } from "../src/tools.js"

const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
const navigate = (url: string) => BrowserTools.normalizeAction({ type: "navigate", tabID, url })

test("URL normalization rejects filesystem paths instead of treating them as hostnames", () => {
  for (const path of ["/tmp/page.html", "./page.html", "../page.html", "C:\\Users\\me\\page.html", "D:/page.html"])
    expect(() => navigate(path)).toThrow("Unsupported browser URL")
  expect(navigate("example.com/docs")).toEqual({ type: "navigate", tabID, url: "https://example.com/docs" })
  expect(navigate("localhost:8000")).toEqual({ type: "navigate", tabID, url: "http://localhost:8000/" })
  expect(BrowserTools.normalizeAction({ type: "tabs.open" })).toEqual({ type: "tabs.open" })
  expect(BrowserTools.normalizeAction({ type: "tabs.open", url: " " })).toEqual({
    type: "tabs.open",
    url: "about:blank",
  })
})

test("URL normalization fails fast when percent-encoding exceeds the command bound", () => {
  const input = `https://example.com/${"é".repeat(400)}`
  expect(input.length).toBeLessThan(2_048)
  expect(new URL(input).href.length).toBeGreaterThan(2_048)
  expect(() => navigate(input)).toThrow()
})

test("browser operations use risk-specific permission actions", () => {
  expect(BrowserTools.permissionAction({ type: "snapshot", tabID })).toBe("browser.observe")
  expect(BrowserTools.permissionAction({ type: "navigate", tabID, url: "https://example.com" })).toBe(
    "browser.navigate",
  )
  expect(BrowserTools.permissionAction({ type: "click", tabID, ref: Browser.Ref.make("@e1") })).toBe("browser.interact")
  expect(BrowserTools.permissionAction({ type: "evaluate", tabID, script: "document.title" })).toBe("browser.execute")
  expect(BrowserTools.permissionAction({ type: "preview", path: "report.html" })).toBe("browser.files")
  expect(BrowserTools.permissionAction({ type: "heap.snapshot", tabID })).toBe("browser.profile")
})

test("explicit private-network browser resources require the extra network permission", () => {
  for (const resource of [
    "http://localhost:3000/",
    "http://api.localhost/",
    "http://127.0.0.1/",
    "http://10.2.101.111/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
  ])
    expect(BrowserTools.isPrivateNetworkResource(resource), resource).toBe(true)

  for (const resource of ["https://example.com/", "https://172.example.com/", "report.html", "browser://tabs"])
    expect(BrowserTools.isPrivateNetworkResource(resource), resource).toBe(false)
})

test("saved capture names never escape their directory or name a Windows device", async () => {
  const file = (name: string) => ({
    id: Browser.FileID.make(`file_${crypto.randomUUID()}`),
    name,
    mime: "text/plain",
    data: new TextEncoder().encode(name),
  })
  const saved = await Effect.runPromise(
    BrowserFiles.save([file(".."), file("."), file("CON.txt"), file("lpt1"), file("report.html")]),
  )
  try {
    expect(saved.map((entry) => basename(entry.path))).toEqual([
      "capture",
      "capture",
      "capture",
      "capture",
      "report.html",
    ])
    expect(saved.map((entry) => entry.name)).toEqual(["..", ".", "CON.txt", "lpt1", "report.html"])
    expect(await Bun.file(saved[0]!.path).text()).toBe("..")
  } finally {
    await rm(dirname(dirname(saved[0]!.path)), { recursive: true, force: true })
  }
})
