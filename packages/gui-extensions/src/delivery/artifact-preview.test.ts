import { expect, test } from "bun:test"
import { isolatedArtifactHtml } from "./artifact-preview"

test("isolated preview embeds local styles and images and blocks external resources", async () => {
  const files = { "index.html": "a", "styles/main.css": "b", "images/icon.png": "c" }
  const css = btoa('body{background:url("../images/icon.png")}')
  const reads: string[] = []
  const html = await isolatedArtifactHtml(
    "index.html",
    '<link href="styles/main.css"><img src="images/icon.png"><img src="https://elsewhere.invalid/x">',
    files,
    async (name) => {
      reads.push(name)
      return name.endsWith(".css") ? css : btoa("image")
    },
  )
  expect(html).toContain("default-src 'none'")
  expect(html).toContain('href="data:text/css;base64,')
  expect(html).toContain('src="data:image/png;base64,')
  expect(html).toContain('src="https://elsewhere.invalid/x"')
  expect(reads.sort()).toEqual(["images/icon.png", "styles/main.css"])
})
