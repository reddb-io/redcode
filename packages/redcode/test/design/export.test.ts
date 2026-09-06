import { describe, expect, test } from "bun:test"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "path"
import { DesignExport } from "@/design/export"

const scratch = async (files: Record<string, string>) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-export-"))
  for (const [file, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await fs.writeFile(path.join(root, file), body)
  }
  return root
}

describe("the export", () => {
  test("inlines the prototype's own assets and the design assets we ship, and leaves the network alone", async () => {
    const root = await scratch({
      "index.html":
        '<html><head><link rel="stylesheet" href="style.css"><script src="../../vendor/tailwind.js"></script>' +
        '<link rel="stylesheet" href="/design/vendor/daisyui.css">' +
        '<link rel="stylesheet" href="https://fonts.example/css"></head><body><img src="hero.png"></body></html>',
      "style.css": "body{color:red}",
      "hero.png": "not really a png",
    })
    const html = await fs.readFile(path.join(root, "index.html"), "utf8")
    const result = await DesignExport.build(root, html)
    expect(result.html).toContain("<style>body{color:red}</style>")
    expect(result.html).toContain('src="data:image/png;base64,')
    // The vendored assets went in by their content, not by a path that only the server knows.
    expect(result.html).not.toContain("../../vendor/tailwind.js")
    expect(result.html).not.toContain("/design/vendor/daisyui.css")
    expect(result.html.length).toBeGreaterThan(100_000)
    // A remote stylesheet is the browser's to load.
    expect(result.html).toContain('href="https://fonts.example/css"')
    expect(result.unresolved).toEqual([])
  })

  test("refuses to carry anything from outside the prototype, symlinks included", async () => {
    const outside = await scratch({ "secret.txt": "hunter2" })
    const root = await scratch({
      "index.html": `<html><body><img src="../${path.basename(outside)}/secret.txt"><img src="link.png"></body></html>`,
    })
    await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "link.png"))
    const html = await fs.readFile(path.join(root, "index.html"), "utf8")
    const result = await DesignExport.build(root, html)
    expect(result.html).not.toContain("hunter2")
    expect(result.html).not.toContain(Buffer.from("hunter2").toString("base64"))
    expect(result.unresolved.map((w) => w.kind).sort()).toEqual(["outside-root", "outside-root"])
  })

  test("respects the caps and says which asset did not fit", async () => {
    const root = await scratch({
      "index.html": '<html><body><img src="big.png"><img src="small.png"></body></html>',
      "big.png": "x".repeat(5000),
      "small.png": "y",
    })
    const html = await fs.readFile(path.join(root, "index.html"), "utf8")
    const result = await DesignExport.build(root, html, { maxAssetBytes: 1000 })
    expect(result.unresolved).toHaveLength(1)
    expect(result.unresolved[0]).toMatchObject({ kind: "too-large", ref: "big.png" })
    expect(result.html).toContain('src="data:image/png;base64,eQ=="')
  })

  test("names the file for a person and for every browser", () => {
    expect(DesignExport.fileName("hero")).toBe("hero.export.html")
    expect(DesignExport.fileName("report.html")).toBe("report.export.html")
    expect(DesignExport.defaultOut("/w/designs/hero", "hero")).toBe(path.join("/w/designs/hero", ".review", "hero.export.html"))
    const disposition = DesignExport.contentDisposition('café "1"')
    expect(disposition).toContain('filename="caf_ _1_.export.html"')
    expect(disposition).toContain("filename*=UTF-8''caf%C3%A9%20%221%22.export.html")
    expect(DesignExport.summary(0, 0)).toBe("Exported.")
    expect(DesignExport.summary(1, 2)).toBe("Exported with 1 unresolved asset and 2 notices.")
    expect(DesignExport.summary(3, 0)).toBe("Exported with 3 unresolved assets.")
  })

  test("answers a vendor path only under the prototype's own parent, and only for what we ship", () => {
    const root = "/w/designs/hero"
    expect(DesignExport.vendorAssetFor("/w/vendor/tailwind.js", root)?.mime).toContain("javascript")
    expect(DesignExport.vendorAssetFor("/w/vendor/nope.js", root)).toBeUndefined()
    expect(DesignExport.vendorAssetFor("/elsewhere/vendor/tailwind.js", root)).toBeUndefined()
  })
})
