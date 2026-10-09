import { expect, test } from "bun:test"
import {
  allowedDestination,
  destinationOrigin,
  fileURLWithin,
  localFileURL,
  normalizeURL,
  refusal,
  reviewAuthorization,
} from "./policy"

test("allows cross-origin HTTP navigation but rejects unsafe destinations and embedded credentials", () => {
  expect(destinationOrigin("https://other.example/path")).toBe("https://other.example")
  expect(destinationOrigin("http://localhost:3000/")).toBe("http://localhost:3000")

  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:pass@example.com",
  ]) {
    expect(destinationOrigin(url)).toBeUndefined()
  }
})

test("file documents load only from allowed workspace roots and never from a host", () => {
  expect(localFileURL("file:///C:/work/out/report.html")).toBe("file:///C:/work/out/report.html")
  expect(localFileURL("file://server/share/report.html")).toBeUndefined()
  expect(localFileURL("https://example.com")).toBeUndefined()

  const roots = ["/home/me/repo"]
  expect(fileURLWithin("file:///home/me/repo/out/index.html", roots)).toBe(true)
  expect(fileURLWithin("file:///home/me/repo", roots)).toBe(true)
  expect(fileURLWithin("file:///home/me/repo-other/x.html", roots)).toBe(false)
  expect(fileURLWithin("file:///home/me/.aws/credentials", roots)).toBe(false)
  expect(fileURLWithin("file:///home/me/repo/../.aws/credentials", roots)).toBe(false)
  expect(fileURLWithin("file:///home/me/repo/out/%2e%2e/%2e%2e/.aws/credentials", roots)).toBe(false)
  expect(fileURLWithin("file:///home/me/repo/x.html", [])).toBe(false)
  expect(fileURLWithin("file://server/home/me/repo/x.html", roots)).toBe(false)

  expect(allowedDestination("file:///home/me/repo/x.html")).toBe(false)
  expect(allowedDestination("file:///home/me/repo/x.html", { fileRoots: roots })).toBe(true)
  expect(allowedDestination("file:///etc/passwd", { fileRoots: roots })).toBe(false)
  expect(allowedDestination("javascript:alert(1)", { fileRoots: roots })).toBe(false)

  expect(normalizeURL("file:///home/me/repo/x.html", { fileRoots: roots })).toBe("file:///home/me/repo/x.html")
  expect(() => normalizeURL("file:///home/me/repo/x.html")).toThrow()
  expect(() => normalizeURL("file:///etc/passwd", { fileRoots: roots })).toThrow()
  expect(normalizeURL("localhost:3000", { fileRoots: roots })).toBe("http://localhost:3000")
  expect(normalizeURL("app.localhost:3000/")).toBe("http://app.localhost:3000/")
  expect(normalizeURL(" ABOUT:BLANK ")).toBe("about:blank")
})

test("the pane names why it refuses an address, so the window can explain it", () => {
  const roots = ["/home/me/repo"]

  expect(
    [
      "example.com",
      "about:blank",
      "file:///home/me/repo/x.html",
      "https://user:pass@example.com",
      "file:///etc/passwd",
      "file://server/home/me/repo/x.html",
      "ftp://example.com",
      "about:config",
    ].map((url) => refusal(url, { fileRoots: roots })),
  ).toEqual([
    undefined,
    undefined,
    undefined,
    "browser.address.credentials",
    "browser.address.workspace",
    "browser.address.workspace",
    "browser.address.workspace",
    "browser.address.workspace",
  ])
  // Where no files open, only web pages do.
  expect(refusal("file:///home/me/repo/x.html")).toBe("browser.address.web")
  expect(() => normalizeURL("https://user:pass@example.com")).toThrow("user name or password")
})

test("windows workspace roots match drive-letter file URLs", () => {
  const roots = ["C:\\Users\\me\\repo"]
  const inside = process.platform === "win32"
  expect(fileURLWithin("file:///C:/Users/me/repo/out/index.html", roots)).toBe(true)
  expect(fileURLWithin("file:///c:/users/me/repo/out/index.html", roots)).toBe(inside)
  expect(fileURLWithin("file:///C:/Users/me/repo2/x.html", roots)).toBe(false)
  expect(fileURLWithin("file:///D:/Users/me/repo/x.html", roots)).toBe(false)
})

test("the server credential reaches only this session's Design review on the server's origin, from that page itself", () => {
  const server = { url: "http://127.0.0.1:4096", sessionID: "ses_a", authorization: "Basic c2VjcmV0" }
  const review = "http://127.0.0.1:4096/design/session/ses_a/review?embed=1"
  const own = { method: "GET", resourceType: "xhr", initiatorOrigin: "http://127.0.0.1:4096" }
  const credential = (request: { url: string; method: string; resourceType: string; initiatorOrigin?: string }) =>
    reviewAuthorization(request, server)

  // The Design panel's navigation, then the page's own reads and writes.
  expect(credential({ url: review, method: "GET", resourceType: "mainFrame" })).toBe(server.authorization)
  expect(credential({ ...own, url: "http://127.0.0.1:4096/design/session/ses_a/feed?after=0" })).toBe(
    server.authorization,
  )
  expect(credential({ ...own, url: "http://127.0.0.1:4096/design/session/ses_a", method: "POST" })).toBe(
    server.authorization,
  )

  for (const request of [
    // Another origin: another port, host name or scheme of the same machine, or an unrelated site.
    { ...own, url: "http://127.0.0.1:5173/design/session/ses_a/review", initiatorOrigin: "http://127.0.0.1:5173" },
    { ...own, url: "http://localhost:4096/design/session/ses_a/review", initiatorOrigin: "http://localhost:4096" },
    { ...own, url: "https://127.0.0.1:4096/design/session/ses_a/review", initiatorOrigin: "https://127.0.0.1:4096" },
    { url: "https://evil.example/design/session/ses_a/review", method: "GET", resourceType: "mainFrame" },
    // The server's other routes and other sessions' reviews.
    { ...own, url: "http://127.0.0.1:4096/api/session" },
    { ...own, url: "http://127.0.0.1:4096/design/session/ses_b/review" },
    { ...own, url: "http://127.0.0.1:4096/design/session/ses_ab/review" },
    { ...own, url: "http://127.0.0.1:4096/design/session/ses_a/../../api/session" },
    // Requests and navigations another site starts toward the review.
    { url: review, method: "GET", resourceType: "xhr", initiatorOrigin: "https://evil.example" },
    { url: review, method: "GET", resourceType: "mainFrame", initiatorOrigin: "https://evil.example" },
    { url: review, method: "GET", resourceType: "subFrame", initiatorOrigin: "https://evil.example" },
    { url: review, method: "GET", resourceType: "xhr", initiatorOrigin: "null" },
    // Only a plain navigation the browser started itself; a subresource always names its page.
    { url: review, method: "POST", resourceType: "mainFrame" },
    { url: review, method: "GET", resourceType: "image" },
  ])
    expect(credential(request)).toBeUndefined()

  // A server without a password has no credential to give.
  expect(
    reviewAuthorization(
      { url: review, method: "GET", resourceType: "mainFrame" },
      { ...server, authorization: undefined },
    ),
  ).toBeUndefined()
})
