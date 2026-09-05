import { describe, expect, test } from "bun:test"
import path from "path"
import { MAX_FILE_BYTES, mimeFor, prototypeCSP, resolve } from "@/design/serve"

const root = path.resolve("/tmp/proto")

describe("what a prototype directory may serve", () => {
  test("serves the page and the assets beside it", () => {
    expect(resolve(root, "/index.html")).toBe(path.join(root, "index.html"))
    expect(resolve(root, "/assets/app.css")).toBe(path.join(root, "assets/app.css"))
    expect(mimeFor("index.html")).toContain("text/html")
  })

  test("cannot be talked out of the directory", () => {
    // The obvious traversal, the encoded one, and the absolute path.
    expect(resolve(root, "/../../etc/passwd")).toBeUndefined()
    expect(resolve(root, "/%2e%2e%2f%2e%2e%2fetc%2fpasswd")).toBeUndefined()
    expect(resolve(root, "/etc/passwd".replace("/etc", path.resolve("/etc")))).toBeUndefined()
    // A sibling directory sharing the prefix is not inside it.
    expect(resolve(root, "/../proto-secrets/index.html")).toBeUndefined()
  })

  test("refuses what is not part of a page, which keeps secrets out without naming them", () => {
    expect(resolve(root, "/.env")).toBeUndefined()
    expect(resolve(root, "/.git/config")).toBeUndefined()
    expect(resolve(root, "/notes.md")).toBeUndefined()
    expect(resolve(root, "/run.sh")).toBeUndefined()
  })

  test("refuses malformed requests rather than guessing", () => {
    expect(resolve(root, "/%zz")).toBeUndefined()
    expect(resolve(root, "/index.html\0.png")).toBeUndefined()
    expect(resolve(root, "/")).toBeUndefined()
    expect(resolve(root, "/assets/")).toBeUndefined()
  })

  test("the document is opaque-origin and can reach nothing", () => {
    const csp = prototypeCSP({ assets: "http://127.0.0.1:4096/design/s1/p1/files/" })
    // The header form, so it holds even when the URL is opened directly rather than framed.
    expect(csp).toContain("sandbox allow-scripts")
    expect(csp).not.toContain("allow-same-origin")
    // Inline is the only script mode that can work at an opaque origin, and it is safe because:
    expect(csp).toContain("script-src 'unsafe-inline'")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("form-action 'none'")
    // Its own assets still load.
    expect(csp).toContain("http://127.0.0.1:4096/design/s1/p1/files/")
  })

  test("a prototype is a page, not a payload", () => {
    expect(MAX_FILE_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024)
  })
})
